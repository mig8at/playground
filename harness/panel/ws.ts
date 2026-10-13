// ws.ts — un WebSocket mínimo para el celular del panel, sin dependencias.
//
// El panel no trae librería de WebSocket y para esto no hace falta una: el servidor MANDA cuadros (binario) y RECIBE
// toques y teclas (texto JSON, chicos). Cubre lo que usan los navegadores de hoy: el saludo de RFC 6455, marcos de
// texto y binario sin fragmentar, ping/pong y cierre. Un marco fragmentado o más grande de lo razonable cierra la
// conexión: del panel no llega nada así.
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_IN = 64 * 1024;

export interface Socket {
    sendBinary(data: Buffer): void;
    sendText(text: string): void;
    close(): void;
    /** Cuántos bytes esperan salir: si la red no da abasto, el que manda cuadros se salta los de en medio. */
    buffered(): number;
    onText(fn: (text: string) => void): void;
    onClose(fn: () => void): void;
}

/** Completa el saludo y devuelve el socket, o null si la petición no es un WebSocket válido (y la corta). */
export function accept(req: IncomingMessage, socket: Duplex): Socket | null {
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return null; }
    const acceptKey = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey}\r\n\r\n`);
    (socket as Duplex & { setNoDelay?: (v: boolean) => void }).setNoDelay?.(true);

    const textHandlers: ((t: string) => void)[] = [];
    const closeHandlers: (() => void)[] = [];
    let closed = false;
    const finish = () => { if (closed) return; closed = true; for (const fn of closeHandlers) fn(); socket.destroy(); };

    const frame = (opcode: number, payload: Buffer) => {
        if (closed || socket.destroyed) return;
        const n = payload.length;
        const head = n < 126 ? Buffer.from([0x80 | opcode, n])
            : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xff])
            : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
        socket.write(Buffer.concat([head, payload]));
    };

    let pending = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 2) {
            const fin = (pending[0] & 0x80) !== 0, opcode = pending[0] & 0x0f, masked = (pending[1] & 0x80) !== 0;
            let len = pending[1] & 0x7f, off = 2;
            if (len === 126) { if (pending.length < 4) return; len = pending.readUInt16BE(2); off = 4; }
            else if (len === 127) { if (pending.length < 10) return; const big = pending.readBigUInt64BE(2); if (big > BigInt(MAX_IN)) return finish(); len = Number(big); off = 10; }
            if (!fin || len > MAX_IN || !masked) return finish();
            if (pending.length < off + 4 + len) return;
            const mask = pending.subarray(off, off + 4);
            const data = Buffer.from(pending.subarray(off + 4, off + 4 + len));
            for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
            pending = pending.subarray(off + 4 + len);
            if (opcode === 0x1) for (const fn of textHandlers) fn(data.toString('utf8'));
            else if (opcode === 0x8) { frame(0x8, Buffer.alloc(0)); return finish(); }
            else if (opcode === 0x9) frame(0xa, data);
        }
    });
    socket.on('close', finish);
    socket.on('error', finish);

    return {
        sendBinary: (data) => frame(0x2, data),
        sendText: (text) => frame(0x1, Buffer.from(text, 'utf8')),
        close: () => { frame(0x8, Buffer.alloc(0)); finish(); },
        buffered: () => (socket as Duplex & { writableLength: number }).writableLength ?? 0,
        onText: (fn) => { textHandlers.push(fn); },
        onClose: (fn) => { closeHandlers.push(fn); },
    };
}
