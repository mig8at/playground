// El fondo de Probeta-qa: el ícono abre el panel lateral. Lo demás va directo entre la página (content.js) y el panel
// (sidepanel.js) por mensajes de la extensión.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
