# My Virtual Museum

J'ai un GLB contenant l'ensemble des assets : des morceaux de scènes et des objets qui permettent la génération d'une scène complète.
Chaque asset a son origine centrée au niveau du sol et est représentée sur une tuile invisible de 4m par 4m.

L'organisation des assets dans le fichier GLB est faite de façon nominative : 
``, par exemple : "wall_east_3"

On a une scène threeJS qui prend toute la fenetre. Cette visualisation 3D est bloquée en vue orthographique vue du dessus avec un léger angle pour un effet isométrique des murs (on reste quand même principalement en vue du dessus)
On a sur le bas de la vue une librairie des assets par dessus le canvas threejs. Cet librairie est organisée par catégorie mais n'affiche pas toutes les variations d'un même asset
On peut visualiser une mignature de chaque asset (la mignature est faire dans la même perspective isométrique que la scène) et faire un glisser déposé dans la scène.
On place alors toujours l'asset à Y 0, et le positionnement est faite sur une grille de 1m.
Les assets peuvent êtres superposés les uns aux autre.
En mode glisser-déposer, si on approche l'asset du bord de la fenetre on a un pad automatique de la vue.
Une fois l'asset placé, on le selectionne (outline simple de l'asset) et on affiche un gizmo de deplacement X et Z.
Si on double clique ailleur que sur un objet dans la vue, cela deselectionne l'ensemble des objets.
Un clique and drag effectue un pad de la vue isométrique mais de deselectionne pas l'objet courant.
Un zoom dezoom avec la molette de la souris permet de zoomer dans la scène.
Au survol d'un asset avec la souris (sauf si le placement d'un asset est en cours) on effectue un peut hightlight de l'asset.
Comme plusieurs assets peuvent se superposer, on fait d'abord un raycast depuis la souris pour identifier l'ensemble des assets survollés, puis on identifie celui réellement survollé par la souris via raycast sur le maillage.
Quand un objet est selectionné, on a (de la même manière que le la boite de la libraire en superposition du canvas en bas de l'écran), une boite de propriétés de l'objet selectionné.
Dans cette boite de propriété on a les options suivantes : 
- supprimer l'objet (ainsi que toutes les textures "templates" associées)
- tourner l'objet de 90 degrés sens horaire
- tourner l'objet de 90 degrés sens anti-horaire
- champs textes permettant de nommer chaque image template (par defaut numerotation incrémentée à chaque ajout d'image template)

Un objet peut être composé de plusieurs materiaux.
Parmis ces matériaux, l'un d'entre eux n'est pas rendu et se nomme "template" (il n'y a pas systématiquement le matériaux "template" sur tous les assets)
Ce materiaux indique toutes les faces utilisées comme zone d'image, il est appliqué à des faces qui sont toujours rectangulaires planes ayant une uv map représentant une face rectangulaire mais attention : le rectangle d'UV d'une face "template" est bien orienté et est bien dimentionné, mais peut être situé n'importe ou sur la zone UV.

En haut à gauche de la fenetre j'ai les boutons suivants : 
- Sauvegarder : permet de sauvegarder la scène sous la forme d'une fichier JSON
- charger : permet de charger une sauvegarde JSON
- reset : permet de reset l'éditeur
- render texture : permet d'exporter sous la forme d'une texture unique les couleurs de objets, leur ambient occlusion et les lumières de la scène
- render template : permet d'exporter sous la forme d'une texture carrée SVG l'ensemble des quad de templates avec leurs labels.

# Renders



# Code rules

Je ne veux pas de "tips" dans la vue, uniquement les input, le canvas et les indication demandées.
Le code doit être structuré en classes JS statique ou non, mais aucune méthode ni attributs ni constantes ne devrait être en dehors d'une classe.
le style css est minimal : je veux un thème épurée, avec boites arrondies