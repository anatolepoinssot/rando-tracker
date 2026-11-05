# Rando Tracker

Application locale pour suivre tes randonnées : carte 3D de tes traces avec survol animé, statistiques détaillées, treks sur plusieurs jours, sommets et cols gravis, fiches compagnons exportables en PDF, et photos placées sur la trace.

Tout reste sur ton ordinateur, dans le dossier `data/`. Internet sert uniquement aux fonds de carte et aux noms de lieux (OpenStreetMap).

## Installation

1. Installe **Python 3.10 ou plus récent** depuis [python.org](https://www.python.org/downloads/). Sous Windows, coche **« Add Python to PATH »** pendant l'installation.
2. Télécharge l'application : bouton vert **Code → Download ZIP** en haut de cette page, puis décompresse-la où tu veux.

## Lancement

- **Windows** : double-clique sur `Lancer (Windows).bat`.
- **Mac** : double-clique sur `Lancer (Mac).command`. La première fois, fais clic droit → Ouvrir.
- **Ligne de commande** : `pip install -r requirements.txt`, puis `python run.py`.

Le navigateur s'ouvre sur <http://127.0.0.1:8000>. L'application démarre vide. Pour l'arrêter, ferme la fenêtre du terminal.

## Importer tes sorties

Formats acceptés : **GPX, FIT et TCX**, y compris compressés en `.gz`. Glisse tes fichiers sur la page, ou utilise les boutons d'import.

**Depuis Strava** : demande ton archive (Paramètres → Mon compte → Télécharger ou supprimer votre compte), décompresse-la, puis glisse le dossier entier sur la page. L'application récupère :

- le nom et la description de chaque sortie ;
- les photos, qu'elle rattache à la bonne sortie grâce à leur heure ou leur position.

Tu peux réimporter ton archive plus tard : les doublons sont ignorés.

## Bon à savoir

- **Photos** : glissées sur la fiche d'une sortie, elles se placent seules sur la trace grâce à leur position GPS ou à leur heure de prise de vue. Celles qui restent « non placées » se positionnent d'un clic sur la carte.
- **Treks** : « Sélectionner » au-dessus de la liste, coche les étapes, puis « Réunir en trek ».
- **Sommets** : l'interrupteur Tracés | Sommets en haut à gauche de la carte. « Détecter » trouve les sommets et cols nommés sur tes traces, et « + Ajouter » permet d'en ajouter un sans trace.
- **Vue 3D** : clic droit + glisser (ou `Ctrl` + glisser) pour incliner ou tourner la carte.
- **Fonds de carte** : les fonds IGN ne couvrent que la France. Ailleurs, choisis Satellite ou OpenTopoMap.

## Sauvegarde et mise à jour

Tes données sont toutes dans le dossier **`data/`** : base de données, traces d'origine et photos. Copie-le pour les sauvegarder ou changer d'ordinateur.

Pour mettre à jour l'application, télécharge la nouvelle version et remplace tout **sauf le dossier `data/`**.

## Réglages

Quelques réglages se trouvent dans `app/config.py` :

- `ELEVATION_THRESHOLD_M` : seuil anti-bruit du calcul du D+. Mets 5 à 8 m si ta montre mesure l'altitude par GPS.
- `LOCAL_TIMEZONE` : fuseau horaire utilisé pour les photos.
- `PORT` : port local de l'application.

## Crédits

IGN Géoplateforme · OpenTopoMap / OpenStreetMap · Esri World Imagery · relief Mapzen/AWS Terrain Tiles · Nominatim / Overpass (OpenStreetMap).
