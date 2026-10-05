// Registro compartido: el panel supervisa; el diagnóstico sólo consulta los puertos.
export type MockDef = {
    id: string;          // el sufijo de `bin/mock-<id>` y de `/tmp/mock-<id>.log`
    label: string;       // el nombre que usa el estado de servicios del panel
    port: number;
    portEnv: string;     // la variable con que el mock lee su puerto
    needs: string;       // a quién le hace falta (misma vara que el estado de servicios del panel)
};

// La lista de mocks locales. Los puertos y las variables son los de cada `bin/mock-*` y `server.mjs`.
export const MOCKS: MockDef[] = [
    { id: 'preapprovals', label: 'pre-aprobaciones', port: 8095, portEnv: 'MOCK_PA_PORT', needs: 'todos' },
    { id: 'redirect', label: 'redirect', port: 8096, portEnv: 'MOCK_REDIRECT_PORT', needs: 'ecommerce' },
    { id: 'payvalida', label: 'payvalida', port: 8097, portEnv: 'MOCK_PV_PORT', needs: 'todos' },
    { id: 'mdm', label: 'mdm/IMEI', port: 8098, portEnv: 'MOCK_MDM_PORT', needs: 'smartpay' },
    { id: 'lenders', label: 'entidades', port: 8099, portEnv: 'MOCK_LENDERS_PORT', needs: 'rt1' },
    { id: 'pdf-mapper', label: 'pdf-mapper', port: 8100, portEnv: 'MOCK_PDFMAP_PORT', needs: 'rt4' },
    { id: 'forms', label: 'forms', port: 8101, portEnv: 'MOCK_FORMS_PORT', needs: 'todos' },
    { id: 'abaco', label: 'ábaco', port: 8102, portEnv: 'MOCK_ABACO_PORT', needs: 'motai' },
    { id: 'corbeta', label: 'corbeta/fondos', port: 8103, portEnv: 'MOCK_CORBETA_PORT', needs: 'qr' },
    { id: 'bancolombia', label: 'bancolombia', port: 8104, portEnv: 'MOCK_BC_PORT', needs: 'qr' },
    { id: 'bureaus', label: 'centrales', port: 8105, portEnv: 'MOCK_BUREAUS_PORT', needs: 'todos' },
    { id: 'deceval', label: 'deceval/pagaré', port: 8106, portEnv: 'MOCK_DECEVAL_PORT', needs: 'rt4' },
    { id: 'netco', label: 'netco/firma', port: 8107, portEnv: 'MOCK_NETCO_PORT', needs: 'rt4' },
    { id: 'credifamilia', label: 'credifamilia/radicación', port: 8108, portEnv: 'MOCK_CREDIFAMILIA_PORT', needs: 'rt4' },
    { id: 'forms-g2', label: 'forms-g2', port: 8109, portEnv: 'MOCK_FORMS_G2_PORT', needs: 'bcp' },
    { id: 'cuotealo', label: 'cuotealo/simulador', port: 8110, portEnv: 'MOCK_CUOTEALO_PORT', needs: 'bcp' },
    { id: 'codes', label: 'códigos', port: 8111, portEnv: 'MOCK_CODES_PORT', needs: 'código de la app' },
    { id: 'wompi', label: 'wompi/cuota inicial', port: 8112, portEnv: 'MOCK_WOMPI_PORT', needs: 'cuota inicial' },
    { id: 'financial-health', label: 'fin-health', port: Number(process.env.MOCK_FINHEALTH_PORT) || 4000, portEnv: 'MOCK_FINHEALTH_PORT', needs: 'todos' },
];
