# Rando Tracker

Application locale pour suivre tes randonnées :

- **Carte 3D** : relief réel, fonds IGN (plan et photos aériennes) ou satellite mondial, toutes tes traces colorées par année, dénivelé, distance ou activité, et un survol 3D animé de chaque sortie.
- **Statistiques** : totaux, regroupements (mois, année, saison, compagnon, région, massif, tranche de distance ou de D+…), cumul par année, nuage distance/dénivelé, records, tableau triable et export CSV. Les filtres de la colonne de gauche s'appliquent partout : liste, carte et stats.
- **Détails** : compagnons, note, notes libres, massif, et photos placées automatiquement sur la trace.

Tout reste sur ton ordinateur, dans le dossier `data/`. Internet sert uniquement à afficher les fonds de carte et à trouver le nom de la commune.

---

## Installation (une seule fois)

1. Installe **Python 3.10 ou plus récent** depuis [python.org](https://www.python.org/downloads/). Sous Windows, coche **« Add Python to PATH »** pendant l'installation.
2. Récupère l'application :
   - **sans Git** : en haut de cette page GitHub, clique sur le bouton vert **Code**, puis **Download ZIP**, et décompresse le fichier où tu veux, par exemple dans `Documents/rando-tracker` ;
   - **avec Git** : `git clone` l'adresse du dépôt.

L'application démarre vide : le dossier `data/` est créé au premier lancement, et tes sorties, photos et compagnons n'y sont stockés que sur ton ordinateur. Ils ne sont jamais envoyés sur GitHub.

## Lancement

- **Windows** : double-clique sur `Lancer (Windows).bat`.
- **Ou en ligne de commande** :
  ```bash
  pip install -r requirements.txt
  python run.py
  ```

Le navigateur s'ouvre sur <http://127.0.0.1:8000>. Pour arrêter, ferme la fenêtre du terminal ou fais `Ctrl+C`.

---

## Utilisation

### Importer tes sorties

Formats acceptés : **GPX, FIT et TCX**, y compris compressés en `.gz` comme dans les exports Strava.

**Depuis un export Strava** (Paramètres → Mon compte → Télécharger ou supprimer votre compte → Demander une archive) :

1. Décompresse l'archive reçue par e-mail.
2. Clique sur **« Importer un dossier »** et choisis le dossier décompressé, ou glisse ce dossier sur la page.
3. Une fenêtre liste tes types d'activités. Les randonnées et le trail sont cochés d'office ; coche ou décoche le reste.

Les **photos du dossier `media/`** sont importées en même temps. Strava ne précise pas à quelle activité appartient chaque photo, donc l'application la rattache à la sortie en cours à son heure de prise de vue, ou à défaut à celle dont la trace passe à sa position GPS. Celles qu'elle ne peut pas rattacher sont signalées. Tu peux aussi glisser un dossier qui ne contient que des photos : elles seront rattachées de la même façon.

L'application lit le fichier `activities.csv` de l'export pour récupérer **le nom que tu as donné à chaque sortie et sa description**, qui va dans les notes. Les noms automatiques de Strava (« Randonnée le matin », « Morning Hike »…) sont remplacés par « Randonnée à *nom de la commune* ».

**Fichiers isolés** : glisse-les n'importe où sur la page, ou utilise « Importer des fichiers ». Pour Garmin Connect : une activité → ⚙️ → Exporter le fichier d'origine (FIT) ou Exporter au format GPX.

Ce qui est géré automatiquement :

- **Doublons** : une même sortie présente en GPX et en FIT n'est importée qu'une fois. Le fichier FIT, celui d'origine de la montre, est préféré, et le second fichier complète le premier (nom, description, cardio). Tu peux réimporter ton export entier plus tard : seules les nouvelles sorties seront ajoutées.
- **Activités sans GPS** (salle, tapis) : ignorées.

Pour chaque sortie, l'application calcule automatiquement :

- la distance, le D+ et le D−, avec un lissage pour ne pas compter le bruit de l'altimètre ;
- la durée totale et le temps en mouvement, sans les pauses ;
- la vitesse moyenne, la vitesse ascensionnelle et les altitudes min/max ;
- la fréquence cardiaque moyenne et maximale, si la montre l'enregistre.

La commune, le département et la région sont retrouvés en tâche de fond. Les sorties sans nom sont renommées, par exemple « Randonnée à Chamonix-Mont-Blanc ».

### Réunir plusieurs sorties en un trek

Pour une itinérance de plusieurs jours :

1. Clique sur **« Sélectionner »** au-dessus de la liste.
2. Coche les étapes.
3. Clique sur **« Réunir en trek »**.

Le trek apparaît comme une seule ligne, que tu peux déplier pour voir ses étapes. Sa fiche donne :

- les totaux, les moyennes par jour et le profil altimétrique complet, avec un repère au début de chaque étape ;
- la liste des étapes et les sommets franchis ;
- toutes les photos des étapes, et un survol 3D du trek entier.

Le nom proposé reprend le début commun aux noms des étapes, et tu peux le modifier. Pour ajouter une étape, coche le trek et la nouvelle sortie, puis « Ajouter au trek ». Pour en retirer une, utilise la croix de l'étape dans la fiche du trek ou « retirer du trek » dans sa fiche. « Dissoudre le trek » ne supprime aucune sortie.

### Sommets et cols

L'interrupteur **Tracés | Sommets**, en haut à gauche de la carte, fait passer de tes traces à tes sommets et cols. Chaque passage a sa fiche, où tu renseignes la date, l'altitude, les personnes, une photo et des notes. Un même sommet gravi plusieurs fois affiche un « ×2 » sur la carte. Quand tu dézoomes, les sommets proches sont regroupés en une pastille (« ▲ 4 ») : clique dessus pour zoomer. De loin, un sommet isolé n'affiche que son icône, avec son nom au survol de la souris.

- **Détecter** : l'application cherche dans OpenStreetMap les sommets et cols nommés par lesquels passent tes traces, et te les propose à valider.
  - Le point culminant de chaque trace est signalé, qu'il s'agisse d'un sommet ou d'un col. S'il ne correspond à rien de nommé, tu peux lui donner un nom.
  - Les compagnons de la sortie sont repris automatiquement.
  - La détection est disponible pour toutes tes sorties (bouton « Détecter » en mode Sommets), pour une sortie ou pour un trek (bouton dans sa fiche).
- **+ Ajouter** : pour un sommet sans trace, cherche-le par son nom ou place-le d'un clic sur la carte. L'altitude est lue sur le relief si elle manque.
- **La photo d'un sommet** : envoie un fichier, ou choisis une photo de la sortie liée. Les plus proches du sommet sont proposées en premier.

### Fiche compagnon

L'onglet **Compagnons** montre une carte par personne, avec sa photo. Tu peux aussi cliquer sur un nom dans la fiche d'une sortie, d'un trek ou d'un sommet. La fiche contient :

- **la photo de profil** : clique sur le rond pour en ajouter ou en changer une, recadrée automatiquement au carré ;
- **la période** : « Toutes les années », une seule année, ou plusieurs années (clique sur chacune pour les cumuler) ;
- **les statistiques** : sorties, distance, dénivelé positif, temps en mouvement, plus haut point atteint ensemble, et le détail année par année ;
- **les sommets, cols et lieux marquants** faits ensemble : ceux où la personne est indiquée, et ceux liés à une sortie commune ;
- **la liste des sorties communes**.

**« Exporter en PDF »** télécharge une fiche avec la photo, les statistiques, les sommets et lieux, et les sorties de la période choisie.

En plus de Sommet et Col, un sommet peut être un **lieu marquant** (lac, cascade, refuge, point de vue…). On l'ajoute avec « + Ajouter » en mode Sommets.

### Survol avec les photos

Pendant le survol 3D d'une sortie ou d'un trek, la caméra marque une pause à chaque photo placée sur la trace et l'affiche. Les photos prises au même endroit sont montrées ensemble.

Une barre en bas de l'écran permet de mettre en pause (bouton ou barre Espace), de se déplacer dans le survol avec le curseur, et de changer la vitesse (x1, x2, x3).

**Plusieurs photos au même endroit** : dans la fiche d'une sortie, clique sur « Placer plusieurs photos au même endroit… », coche les photos, puis clique sur la carte. Un sommet ou un col peut aussi avoir plusieurs photos.

### Ajouter des photos

Ouvre une sortie, puis glisse tes photos sur la fiche. Les formats JPEG, PNG et HEIC (iPhone) sont acceptés. Chaque photo est placée sur la carte :

1. avec **sa position GPS**, si l'appareil l'a enregistrée ;
2. sinon, avec **son heure de prise de vue**, comparée à l'heure de la trace de la montre ;
3. sinon, elle est marquée « non placée ». Ouvre-la, puis clique sur « Placer sur la carte » : elle s'aimante sur la trace.

Si l'horloge de ton appareil photo était décalée, indique le décalage en minutes dans le champ prévu avant l'envoi. Tes originaux sont conservés intacts.

### Astuces

- Survole le **profil altimétrique** : un point suit ta position sur la carte.
- **Clic droit + glisser** sur la carte pour incliner ou tourner la vue 3D (ou `Ctrl` + glisser).
- Le bouton ⛰ en haut à droite active ou désactive le relief.
- En dézoomant, la vue passe progressivement de la 3D à la 2D. La transition commence quand l'échelle (en bas à droite) est au milieu de sa plage « 30 km » et se termine au milieu de sa plage « 50 km ». En rezoomant, l'inclinaison que tu avais choisie revient.
- Le bouton « / » sur le bord gauche de la carte masque ou affiche la liste et les filtres. Ce choix est mémorisé.
- Les fonds **IGN** ne couvrent que la France. Pour tes treks ailleurs, choisis **Satellite** ou **OpenTopoMap**.
- Dans les stats, clique sur un record, un point du nuage ou une ligne du tableau pour ouvrir la sortie sur la carte.

---

## Mettre à jour l'application

- **Avec Git** : `git pull` dans le dossier de l'application.
- **Sans Git** : télécharge à nouveau le ZIP, puis remplace les dossiers `app/` et `static/` ainsi que les fichiers `requirements.txt` et `README.md` par ceux de la nouvelle version.

Dans les deux cas, **ne touche pas au dossier `data/`** : tes sorties, photos et compagnons y sont conservés. Le lanceur installe tout seul les nouvelles dépendances au démarrage suivant.

## Sauvegarde

Tout est dans le dossier **`data/`** :

| Élément | Emplacement |
|---|---|
| Base de données (sorties, compagnons, notes) | `randos.db` |
| Fichiers de traces d'origine (GPX, FIT, TCX) | `gpx/` |
| Photos (originaux et versions allégées) | `photos/` et `thumbs/` |

Copie ce dossier pour sauvegarder, ou pour transférer l'application sur un autre ordinateur.

## Réglages (`app/config.py`)

| Réglage | Rôle | Défaut |
|---|---|---|
| `ELEVATION_THRESHOLD_M` | Seuil anti-bruit du D+ | 3 m (bien pour un altimètre barométrique ; mets 5 à 8 m pour une montre à altitude GPS) |
| `LOCAL_TIMEZONE` | Fuseau supposé pour les photos sans information de fuseau | `Europe/Paris` |
| `PHOTO_TIME_TOLERANCE_S` | Écart autorisé entre l'heure d'une photo et la trace | 20 min |
| `GEOCODING_ENABLED` | Recherche automatique du nom de la commune | activée |
| `PORT` | Port local de l'application | 8000 |

Après avoir modifié les réglages de calcul, recalcule toutes les sorties. Pendant que l'application tourne, ouvre <http://127.0.0.1:8000/docs>, puis « POST /api/recompute » → « Try it out » → « Execute ».

## Structure du code

```
run.py            lanceur
app/main.py       API (FastAPI)
app/gpx_utils.py  lecture GPX / FIT / TCX et calcul des statistiques
app/photos.py     EXIF, miniatures, HEIC
app/geocode.py    nom de la commune (OpenStreetMap Nominatim)
app/osm.py        sommets et cols : détection sur les traces, recherche par nom
app/report.py     fiche compagnon en PDF
app/db.py         schéma SQLite
static/           interface : app.js (carte, fiches, stats), treks.js, summits.js, people.js, main.js
```

## Crédits des données cartographiques

IGN Géoplateforme · OpenTopoMap / OpenStreetMap · Esri World Imagery · relief Mapzen/AWS Terrain Tiles · géocodage OpenStreetMap Nominatim.
