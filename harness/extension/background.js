// El fondo de la extensión «Cliente de prueba»: el ícono abre el panel lateral. Lo demás va directo entre la página
// (content.js) y el panel (sidepanel.js) por mensajes de la extensión; con el panel cerrado, la página no espera.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
