'use strict';
/* Démarrage, une fois tous les scripts chargés (app.js, treks.js, summits.js). */
initControls();
initMap();
loadAll({ fit: true })
  .then(() => startGeocodePolling())
  .catch(e => toast('Impossible de charger les données : ' + e.message, 8000));
