# My Virtual Museum

J'ai un GLB contenant l'ensemble des assets : des morceaux de scènes et des objets qui permettent la génération d'une scène complète.
Chaque asset a son origine centrée au niveau du sol et est représentée sur une tuile invisible de 4m par 4m.

L'organisation des assets dans le fichier GLB est faite de façon nominative : 
`NAME.VARIATION_NUMBER_000`, par exemple : "Display.005"

On a une scène threeJS qui prend toute la fenetre. Cette visualisation 3D est bloquée en vue orthographique vue du dessus avec un léger angle pour un effet isométrique des murs (on reste quand même principalement en vue du dessus)
On a sur le bas de la vue une librairie des assets par dessus le canvas threejs.
Cette librairie affiche en haute une liste de l'ensemble des "name" sous la forme de bouton. Un clic sur un bouton affiche en dessous toutes les variations de cet élément avec une vignette dans la même perspective isométrique que la scène.

Chacun de ces éléments peut être glissé-déposé dans la scène (cf interactions).

## Exportation

En haut à gauche de la page (toujours par dessus le canvas) il y a une barre contenant plusieurs boutons permettant l'import/export.
`import GLB`: permet d'importer toute la scène via un GLB précédement exporté (on extrait l'ensemble des asset et on les instancie depuis l'éditeur non depuis le GLB)
`export GLB`: exporter toute la scène en GLB
`export PNG` : exporter les deux textures atlas de la scène (Progressive diffuse lightmap et Material properties)
`clear` : permet de reset la scène

Dans le GLB exporté, chaque objet de la scène dispose de deux UV:
- l'uv d'origine de l'asset
- l'uv de l'atlas calculée lors de l'exportation (GLB, DIF ou MAT)

Les deux textures PNG générées par "export PNG" sont :
- la Progressive diffuse lightmap (render des couleurs, des lumières, de l'ambient occlusion)
- la Material properties : alpha, rougness, emission combinées en une unique image RGB

On utilisera unwrapUVAtlas https://github.com/Hoodgail/three-gpu-baker pour le calcul de la Progressive diffuse lightmap.

Attention pour la génération de la Progressive diffuse lightmap : on ferra attention à cacher tout éléments semi transparent avant le bake pour éviter la création d'ombres à des endroit non désiré (pas besoin de blend, à partir du moment ou un materiaux est un peu transparent on peut complètement le chacher pour le bake affin d'éviter tout artefacts).

La seconde texture "Material properties" est générée par une passe de rasterisation GPU en espace UV, en réutilisant exactement l'atlas créé pour la lightmap, sans recalculer les UV ni l'éclairage. Pour chaque fragment, les propriétés du matériau d'origine (valeurs constantes ou textures) sont échantillonnées puis encodées dans les canaux R (opacité), G (roughness) et B (intensité d'émission). Le résultat est exporté en PNG linéaire, avec un padding entre les îlots UV pour éviter les artefacts de filtrage.

L'importation du fichier GLB est intelligente : on importe pas directement les assets ni aucune géométrie ou texture, on detecte juste chaque instance d'asset présent dans le fichier GLB pour placer une asset correspondante depuis l'éditeur. Ainsi l'import de fichier GLB permet de retrouver une scène qui aurait été exporté, le fichier GLB sert ainsi autant de fichier d'export que de fichier de sauvegarde de la scène.

## Lumières

Les assets on différents matériaux.
Parmsi ces matériaux, certains sont spécifiques : 
`light` : emmisive jaune
`light-path`: détermine le positionnement et la direction d'un spot

Le material "light-path" est appliqué à un ou plusieus segments du modèles 3d. Ces segments ne sont pas reliés au reste de la géométrie ni entre eux.
Chaque segment est composé de deux vertices : le premier au dessus de l'axe vertical indique le positionnement du spot lumineux. Le second vertice est lui toujours positionné sous le sol (coordonées Y négéétives dans threeJS) et indique la direction du spot lumineux.

Lors de l'instantiation, on parentera autant de spot lumineux que de segment à l'objet instancié.
Ce sont ces spots qui vont servir au calcul des lumières lors du bake des textures.

## Interactions de déplacement de la camera

En mode glisser-déposer et en mode gizmo, si on approche l'asset du bord de la fenetre on a un pad automatique de la vue.
Un zoom dezoom avec la molette de la souris permet de zoomer dans la scène.
Un clique and drag effectue un pad de la vue isométrique mais ne deselectionne pas les objets.

## Interactions de déplacement des assets
Que ce soit lors du glisser-déposer ou du déplacement via gizmo, on place alors toujours l'asset à Y 0, et le positionnement est encré sur une grille de 1m.
Les assets peuvent êtres superposés les uns aux autre.

Une fois l'asset placé, on le selectionne par clic (outline simple de l'asset) et on affiche un gizmo de deplacement X et Z.
Si on double clique ailleur que sur un objet dans la vue, cela deselectionne l'ensemble des objets.
Il est possible de selectionner plusieurs objets via maintient de la touche SHIFT. On aura alors un outile de couleur différent entre le dernier objet selectionné (correspondant au dernier présent dans la liste de selection) et le reste des éléments selectionné.

Au survol d'un asset avec la souris (sauf si le placement d'un asset est en cours) on effectue un peut hightlight de l'asset.
Comme plusieurs assets peuvent se superposer, on fait d'abord un raycast depuis la souris pour identifier l'ensemble des assets survollés, puis on identifie celui réellement survollé par la souris via raycast sur le maillage.
Quand un objet est selectionné, on a (de la même manière que le la boite de la libraire en superposition du canvas en bas de l'écran), une boite d'édition (actions effectuées sur l'ensemble de la selection) est affichée sur le côté droit.

Quand on ajoute un objet dans la scène, ce n'est pas une instance, c'est une copie complète de l'objet de la librairie. Pourquoi ? Parce que unwrapUVAtlas() ne prend en compte que les objets réel de la scène et non les instances.

## Boite d'édition des objets selectionnés
Dans cette boite de propriété on a les options suivantes : 
- supprimer l'objet
- tourner les objets de 90 degrés sens horaire (par rapport au pivot)
- tourner les objets de 90 degrés sens anti-horaire (par rapport au pivot)

*Information* : Le pivot de rotation de la selection est calculé comme suit :
- on prend le centre de la selection un point moyennant les origines de chaque objets selectionné
- on snap ce pivot soit sur la grille, soit au centre d'une case de la grille.

# Règles d'écriture du code
Je ne veux pas de "tips" dans la vue, uniquement les input, le canvas et les indication demandées.
Le code doit être structuré en classes JS, mais aucune méthode ni attributs ni constantes ne devrait être en dehors d'une classe.
le style css est minimal : je veux un thème épuré et fonctionnel, avec boites arrondies par dessus le canvas threejs.

Voici les classes attendues :
- assets.js : charge le fichier GLB "./all.glb" contenant l'ensemble des assets de l'éditeur et s'occupe de l'instantiation/clone de l'élément pour ajout dans la scène
- scene.js: gère l'affichage de la scène, la grille, le placement des objets avec gizmo et plus générallement l'ensemble des interactions avec le canvas
- app.js : gère l'ui et l'instantiation de la scène
- io.js : gère l'import et l'export de fichier GLB ainsi que la génération de l'atlas UV
- render.js : gère la génération des textures à partir de l'atlas UV
- index.html : code de la page, j'aimerais qu'un maximum de code html soit déjà présent dans la page pour éviter trop de génération par JS. app.js peut générer quelques éléments dynamiques si besoin mais j'aimerais si possible que la structure de l'ui soit au maximum déjà présente dans la vue.
- style.css : style de l'ui
