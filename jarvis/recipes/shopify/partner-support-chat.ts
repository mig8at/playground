// ESCRIBE · abrir el chat de Shopify Support para partners y dejar escrito el mensaje, SIN enviarlo. Es como se retomó
// el contacto con Shopify por la app de pagos (tarea integracion-shopify, 2026-11-13): el buzón de Payments
// Partnerships ya no es la vía de soporte; lo es este chat, que abre un ticket con el correo de copia.
//
//   make jarvis-recipe APP=shopify RECIPE=partner-support-chat ARGS='--file mensaje.txt'
//   make jarvis-recipe APP=shopify RECIPE=partner-support-chat ARGS='--dry'
//
// Pasos: Ayuda de Shopify para partners → «Chat with a human» → «Chat» → el mensaje en «Type a message». La pestaña
// queda abierta para que la persona lo lea, toque Send y siga la conversación: el chat se corta si nadie contesta en
// unos minutos. Lo que conviene escribir: quién sos (organización Partner y su ID, desde qué cuenta), qué necesitás y a
// quién copiar (Shopify agrega a una persona como CC del ticket si se le pide).
//
// Parámetros: --message "texto" o --file <archivo con el texto> (obligatorio salvo --dry) · --dry (abre la Ayuda y el
// menú del chat, sin entrar a la fila) · --json
// Necesita: Jarvis conectado en Chrome y la sesión de Shopify abierta en Chrome (la cuenta dueña: Juan). ⚠ La Ayuda
// atiende a la tienda o a la organización que muestra arriba a la derecha: para temas de partner, que sea la de Partners.
// ESCRIBE: tocar «Chat» entra a la fila de Shopify Support (un asesor se une en minutos). El mensaje NO se envía.
import '../args.ts';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = argv.includes('--json');
const DRY = argv.includes('--dry');
const say = (s: string) => { if (!JSON_OUT) console.log(`  ${s}`); };

const file = flag('file');
const message = (file ? fs.readFileSync(path.resolve(ROOT, file), 'utf8') : flag('message') || '').trim();
if (!DRY && !message) {
    console.error('  uso: partner-support-chat --message "…" | --file <texto> [--dry] [--json]');
    process.exit(2);
}

const jarvis = (...args: string[]) => execFileSync(path.join(ROOT, 'bin/jarvis'), args, { encoding: 'utf8', timeout: 120_000 });
const HELP = 'https://help.shopify.com/en/partners';
say(`abro la Ayuda de Shopify para partners · ${HELP}`);
jarvis('open', HELP);
jarvis('wait', 'Chat with a human', '30');
jarvis('click', 'Chat with a human');
say('«Chat with a human»: ofrece Chat y llamada');
if (DRY) {
    say('--dry: no entro a la fila. La pestaña queda abierta en el menú del chat.');
    if (JSON_OUT) console.log(JSON.stringify({ recipe: 'shopify/partner-support-chat', dry: true }));
    process.exit(0);
}
jarvis('click', 'Chat');
say('«Chat»: en la fila de Shopify Support (un asesor se une en unos minutos)');
jarvis('wait', 'Type a message', '60');
jarvis('fill', 'Type a message', message);
say(`mensaje escrito (${message.length} caracteres), sin enviar: tocá Send en tu Chrome y quedate en la conversación`);
// La pestaña NO se cierra: la persona sigue el chat ahí.
if (JSON_OUT) console.log(JSON.stringify({ recipe: 'shopify/partner-support-chat', queued: true, chars: message.length }));
