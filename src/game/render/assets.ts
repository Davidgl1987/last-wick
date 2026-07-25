/**
 * Assets compartidos: geometrías y materiales creados UNA vez a nivel de
 * módulo. Prohibido crear materiales/geometrías dentro de componentes.
 * Paleta plana, materiales lambert/basic (sin PBR, sin sombras dinámicas).
 */

import * as THREE from 'three';

// ── Geometrías unitarias (se escalan por mesh) ────────────────────────────

export const unitSphere = new THREE.SphereGeometry(1, 24, 16);
export const unitBox = new THREE.BoxGeometry(1, 1, 1);
export const unitCircle = new THREE.CircleGeometry(1, 24);
export const unitPlane = new THREE.PlaneGeometry(1, 1);
/** Cilindro unitario (diámetro 1, alto 1): barriles y otros cuerpos redondos. */
export const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
/** Cono direccional para el hocico/telegrafiado de enemigos (Dummy/Chaser/Shooter). */
export const unitCone = new THREE.ConeGeometry(0.5, 1, 12);
/** Púa del Spike: pirámide alargada apuntando en +Z local. */
export const unitSpike = new THREE.ConeGeometry(0.35, 0.9, 6);
/**
 * Aguja fina del hazard de pinchos del suelo (punto 1 de playtest: "los
 * pinchos no lo parecen"): mucho más estrecha/afilada que `unitSpike` (que es
 * la púa gruesa del enemigo Spike) para poder instanciar un campo denso de
 * conos apuntando hacia arriba sin que se toquen entre sí.
 */
export const unitSpikeNeedle = new THREE.ConeGeometry(0.09, 0.32, 6);

// ── Geometrías de proyectiles con forma (puntos 2/3/11 de playtest) ───────

/** Asta corta de la flecha, detrás del cono dominante (eje +Y local; se rota para alinear con +Z al orientarla). */
export const arrowShaftGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 8);
/** Segmento del zigzag eléctrico del hechizo: caja alargada instanciada (grosor visible, punto 11). */
export const spellBoltSegmentGeometry = new THREE.BoxGeometry(0.045, 0.045, 1);
/** Chispa de la estela del hechizo: tetraedro minúsculo (barato, distinto de las partículas esféricas normales). */
export const spellSparkGeometry = new THREE.TetrahedronGeometry(1, 0);

// ── Textura radial para blob shadows (generada una vez, sin ficheros) ─────

function createRadialTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.35)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Textura radial BLANCA (centro opaco → borde transparente), generada UNA vez
 * y reutilizada por TODOS los halos de brillo falso (rama `estilo-oscuro`,
 * punto 2 de playtest: "las monedas se ven de otra habitación sin iluminar
 * nada"). A diferencia de `createRadialTexture` (negra, para blob shadows),
 * esta es blanca porque cada halo la tiñe multiplicando por `material.color`
 * con blending ADITIVO (ver más abajo) — así un único mapa sirve para
 * cualquier color de brillo sin generar una textura por objeto.
 */
function createGlowHaloTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Mapa radial blanco→transparente compartido por todos los halos de brillo (ver `createGlowHaloTexture`). */
export const glowHaloTexture = createGlowHaloTexture();

/**
 * Caché de materiales de "charco de luz falso" (ver `GlowPuddle.tsx`), CLAVE
 * `color-hex|opacidad` — nunca se crea un `MeshBasicMaterial` nuevo en tiempo
 * de render: la primera vez que se pide una combinación color+opacidad se
 * crea y se guarda, cualquier petición posterior con la misma combinación
 * devuelve el MISMO objeto. Generaliza el patrón que antes vivía solo en
 * `enemyProjectileGlowHaloMaterials` (más abajo, ahora migrado a esta
 * función) para que enemigos y antorchas puedan pedir su propio charco sin
 * duplicar la construcción del material.
 */
const glowPuddleMaterialCache = new Map<string, THREE.MeshBasicMaterial>();

/**
 * Material aditivo de charco de luz falso para un `color`+`opacity` dados:
 * `glowHaloTexture` (mapa radial blanco→transparente) teñido por
 * `material.color` con `AdditiveBlending` y `depthWrite:false` — el mismo
 * mecanismo barato que ya usaban los halos de proyectil enemigo,
 * indistinguible de una luz real desde la cámara cenital. CACHEADO por
 * `color`+`opacity` (ver `glowPuddleMaterialCache`): llamar a esta función
 * dentro de JSX o de un `useFrame` es seguro, nunca asigna memoria nueva
 * salvo la primera vez que se ve esa combinación exacta.
 */
export function glowPuddleMaterial(color: THREE.ColorRepresentation, opacity: number): THREE.MeshBasicMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${opacity}`;
  let material = glowPuddleMaterialCache.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      map: glowHaloTexture,
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity,
    });
    glowPuddleMaterialCache.set(key, material);
  }
  return material;
}

// ── Materiales ────────────────────────────────────────────────────────────

/**
 * Color del héroe por modo de arma activo (punto 1 de playtest ronda 3): el
 * cuerpo del héroe, su estela y el indicador de puntería cambian al mismo
 * color que su arma seleccionada — mismo lenguaje visual ya usado por
 * WeaponBar (`weapon-btn-<mode>`) y por los proyectiles (arrowMaterial /
 * spellBoltMaterial más abajo). Único punto de verdad para no divergir del CSS.
 */
/**
 * Intercambio de colores cuerpo↔flecha (feedback de playtest, rama
 * `estilo-oscuro`): cuerpo pasa a amarillo, flecha pasa al azul que antes
 * tenía el cuerpo; hechizo no cambia. Afecta a TODOS los modos (dark 0/1/2),
 * a diferencia del resto de este bloque de cambios — ver también
 * `weapon-bar.css` (.weapon-btn-body/.weapon-btn-arrow) y
 * `UpgradeIcon.tsx` (CATEGORY_COLOR), que copian estos mismos valores.
 */
export const WEAPON_COLOR: Record<'body' | 'arrow' | 'spell', THREE.Color> = {
  body: new THREE.Color('#fef08a'),
  arrow: new THREE.Color('#54c7ff'),
  spell: new THREE.Color('#d8b4fe'),
};

/**
 * Material del héroe: MUTABLE (color interpolado cada frame por HeroView
 * según el arma activa, vía `heroMaterial.color.lerp(...)`), a diferencia del
 * resto de materiales de este fichero que son inmutables una vez creados. Es
 * un único objeto compartido (no se recrea nunca), así que sigue cumpliendo
 * "materiales compartidos, creados una vez": solo cambia su propiedad color.
 */
export const heroMaterial = new THREE.MeshLambertMaterial({ color: WEAPON_COLOR.body.clone() });
/**
 * Suelo de sala: ligeramente más claro que el fondo/foso para que los fosos
 * (casi negros) sean inconfundibles a primera vista (GDD §14: legibilidad).
 * Aclarado un punto más (feedback de playtest, punto 4: "prefiero contraste
 * entre el color del suelo y de los fosos") respecto al `#2d3352` original.
 */
export const floorMaterial = new THREE.MeshLambertMaterial({ color: '#464b67' });
export const wallMaterial = new THREE.MeshLambertMaterial({ color: '#3b4266' });
export const rockMaterial = new THREE.MeshLambertMaterial({ color: '#767d99' });
/** Portón de puerta cerrada (se abre al limpiar la sala). */
export const doorMaterial = new THREE.MeshLambertMaterial({ color: '#5a6db3' });
/** Portón de la puerta del jefe (requiere llave): dorado, inconfundible. */
export const doorKeyMaterial = new THREE.MeshLambertMaterial({ color: '#d9a531' });

export const blobShadowMaterial = new THREE.MeshBasicMaterial({
  map: createRadialTexture(),
  transparent: true,
  depthWrite: false,
});

/**
 * Indicador de puntería: MUTABLE igual que `heroMaterial` (punto 1 de
 * playtest ronda 3) — AimIndicatorView interpola su color hacia
 * `WEAPON_COLOR[weaponMode]` cada frame.
 */
export const aimDotMaterial = new THREE.MeshBasicMaterial({
  color: WEAPON_COLOR.body.clone(),
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
});

// ── Feedback visual de mejoras sobre el héroe (docs/plans/ECONOMY_PLAN.md F5) ──

/**
 * Pincho del Erizo de Acero (cuerpo-dano): proporciones pensadas para vivir
 * como HIJO del mesh del héroe (esfera unitaria), así hereda gratis su
 * squash/stretch y el escalado extra de Canto Rodado sin cálculo aparte
 * (ver HeroView). Centrado en la superficie de la esfera unitaria: mitad
 * incrustado, mitad asomando.
 */
export const heroSpikeGeometry = new THREE.ConeGeometry(0.13, 0.4, 6);
/** Acento "acero" de los pinchos: gris-azulado metálico, legible sobre cualquier color de arma del cuerpo. */
export const heroSpikeMaterial = new THREE.MeshLambertMaterial({ color: '#c9d3e6' });

/**
 * Burbuja de Cuarzo (escudo): esfera semitransparente que envuelve la bola
 * mientras `hero.modifiers.shieldCharges > 0`. MUTABLE (opacidad ajustada
 * por HeroView según nº de cargas), igual que `heroMaterial`/`aimDotMaterial`
 * — un único héroe activo a la vez, así que es seguro mutar el material
 * compartido en vez de recrearlo cada frame.
 */
export const heroShieldMaterial = new THREE.MeshBasicMaterial({
  color: '#8fe3ff',
  transparent: true,
  opacity: 0.3,
  depthWrite: false,
});

// ── Enemigos (GDD §7): silueta/color inconfundibles por arquetipo ─────────

export const dummyMaterial = new THREE.MeshLambertMaterial({ color: '#ff5964' });
export const chaserMaterial = new THREE.MeshLambertMaterial({ color: '#ff9f45' });
export const spikeMaterial = new THREE.MeshLambertMaterial({ color: '#9aa1bd' });
export const spikeConeMaterial = new THREE.MeshLambertMaterial({ color: '#e2e6f2' });
export const trailMaterial = new THREE.MeshLambertMaterial({ color: '#4dd68a' });
export const shooterMaterial = new THREE.MeshLambertMaterial({ color: '#2b2f42' });
/** Flash blanco al recibir daño: material único intercambiado temporalmente por features/enemies/EnemyViews. */
export const enemyHitFlashMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
/** Telegrafiado de carga del Shooter: disco pulsante bajo sus pies. */
export const shooterTelegraphMaterial = new THREE.MeshBasicMaterial({
  color: '#ff3b3b',
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

// ── Jefes (GDD §15): cuerpo genérico + anillo de telegraph/vulnerabilidad ──
// compartidos por CUALQUIER jefe (B1-B4 los reutilizan); el jefe de pruebas
// de la Fase B0 los usa directamente sin composición propia.

/** Cuerpo por defecto de un jefe (B1-B4 pueden sustituirlo por su propia composición, ver EnemyViews). */
export const bossBodyMaterial = new THREE.MeshLambertMaterial({ color: '#7a3fd6' });
/** Anillo de telegraph genérico (GDD §15.1 punto 2: aviso visible antes de cualquier ataque). */
export const bossTelegraphMaterial = new THREE.MeshBasicMaterial({
  color: '#ffe083',
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
});
/** Anillo de ventana de vulnerabilidad (GDD §15.1 punto 4): verde, inconfundible frente al ámbar del telegraph. */
export const bossVulnerableMaterial = new THREE.MeshBasicMaterial({
  color: '#4dd68a',
  transparent: true,
  opacity: 0.7,
  depthWrite: false,
});
/** Flash de cambio de fase (GDD §15.1 punto 3): breve destello blanco-cálido en todo el cuerpo. */
export const bossPhaseFlashMaterial = new THREE.MeshBasicMaterial({ color: '#fff2c9' });

// ── Guardián de Canto (GDD §15.2, Fase B1): cuerpo pétreo propio ───────────

/** Cuerpo del Guardián: piedra gris-azulada, distinta de cualquier enemigo normal y del violeta genérico de jefe. */
export const guardianBodyMaterial = new THREE.MeshLambertMaterial({ color: '#5b6270' });
/** Hombros/cuernos: tono más oscuro, silueta "pesada" reconocible. */
export const guardianHornMaterial = new THREE.MeshLambertMaterial({ color: '#3c4048' });
/** Brillo/vibración del telegraph (GDD §15.2 "brilla y vibra"): sustituye al cuerpo entero mientras avisa. */
export const guardianTelegraphGlowMaterial = new THREE.MeshBasicMaterial({ color: '#ffb84d' });
/** Estrellitas del aturdimiento (estado INCONFUNDIBLE, entregable 3): doradas, orbitan sobre la cabeza. */
export const guardianStunStarMaterial = new THREE.MeshBasicMaterial({ color: '#fff2c9' });
/** Cuerno/hombro del Guardián: cono corto y ancho (más "roca tallada" que púa afilada). */
export const guardianHornGeometry = new THREE.ConeGeometry(0.32, 0.55, 6);
/** Estrellita del aturdimiento: tetraedro minúsculo, barato, orbitando. */
export const guardianStunStarGeometry = new THREE.TetrahedronGeometry(1, 0);

// ── Reina del Enjambre (GDD §15.3, Fase B2): cuerpo propio + corona ────────

/** Cuerpo de la Reina: violeta-verdoso oscuro, grande y distinto del Guardián (piedra) y del genérico de jefe. */
export const queenBodyMaterial = new THREE.MeshLambertMaterial({ color: '#5c2a6e' });
/** Púas de la corona: dorado-verdoso, evoca "enjambre"/insecto sin copiar el ámbar del Guardián. */
export const queenCrownMaterial = new THREE.MeshLambertMaterial({ color: '#9fd65c' });
/** Pulso de invocación (GDD §15.3): breve anillo verdoso que se expande al soltar una oleada de larvas. */
export const queenSummonPulseMaterial = new THREE.MeshBasicMaterial({
  color: '#4dd68a',
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});
/** Púa de la corona: cono fino y alargado (silueta de insecto/enjambre), distinto del cuerno romo del Guardián. */
export const queenCrownSpikeGeometry = new THREE.ConeGeometry(0.14, 0.5, 6);

// ── Columnas de la Reina (T2 render, rediseño 2026-07-10, GDD §15.3): la
// intacta reutiliza `rockMaterial` (misma silueta que cualquier roca hasta
// que se agrieta); agrietada/escombros son variantes propias. Ver
// QueenColumnsView.tsx.

/**
 * Columna dañada, 3 niveles de hp (QUEEN_COLUMN_HP=3, playtest 2026-07-10:
 * "debe leerse de un vistazo cuántos golpes le quedan"): cuanto más baja el
 * hp, más oscuro el tono — degradado desde `rockMaterial` (intacta, hp=3).
 */
/** hp=2 (leve, tras el 1.er golpe): tono intermedio entre la roca intacta y la agrietada grave — "le quedan 2 golpes". */
export const queenColumnCrackedLightMaterial = new THREE.MeshLambertMaterial({ color: '#63667f' });
/** hp=1 (grave, tras el 2.º golpe): mismo tono base que la roca pero bastante más oscuro — "le queda un golpe". */
export const queenColumnCrackedMaterial = new THREE.MeshLambertMaterial({ color: '#4a4a56' });
/** Grieta visible sobre la cara de una columna agrietada: franja casi negra, fina, cruzando en diagonal (se reutiliza para hp=2 y hp=1, con escala más corta/fina en hp=2). */
export const queenColumnCrackStripeMaterial = new THREE.MeshBasicMaterial({ color: '#111116' });
/** Restos/escombros tras romperse del todo: mancha baja y muy oscura en el suelo, marca que ahí hubo una columna. */
export const queenColumnDebrisMaterial = new THREE.MeshLambertMaterial({ color: '#2e2e38' });

/**
 * Cuerda/cordón que une a la Reina con cada columna aún en pie: cilindro
 * fino orgánico, PRE-ROTADO en la propia geometría (una vez, a nivel de
 * módulo) para que su eje largo sea +Z local en vez de +Y — mismo patrón que
 * `spellBoltSegmentGeometry` (ProjectileView): el componente solo necesita
 * `rotation.y = atan2(dx, dy)` + `scale.z = longitud` cada frame, sin tocar
 * la geometría base.
 */
export const queenTetherGeometry = new THREE.CylinderGeometry(0.05, 0.05, 1, 6).rotateX(Math.PI / 2);
/** Color orgánico rosa-enjambre (mismo tono que el burst de `boss-columns-cleared`): semitransparente, fino, inconfundible con las rocas/muros. */
export const queenTetherMaterial = new THREE.MeshBasicMaterial({
  color: '#ff6bcb',
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

/**
 * Guardianas de la Reina (larvas embistiendo, GDD §15.3, rediseño 2026-07-10,
 * `enemy.bossStage`: 0=orbita, 1=telegrafía, 2=carga): aviso visual de que
 * van a embestir, mismo lenguaje ámbar=aviso ya usado por el resto de jefes
 * (`bossTelegraphMaterial`), sobre el cuerpo (que en reposo es el rojo
 * genérico de larva/Dummy) en vez de un anillo aparte, para que sea
 * inconfundible incluso entre el resto de larvas atacantes.
 */
/** Telegraph (bossStage=1): parpadea alternando con el rojo base — intercambiado por EnemyViews, nunca mutado. */
export const queenGuardianTelegraphMaterial = new THREE.MeshBasicMaterial({ color: '#ffe083' });
/** Carga (bossStage=2, opcional): tono rojo más intenso y saturado que el reposo — "ya viene, esquiva". */
export const queenGuardianChargeMaterial = new THREE.MeshBasicMaterial({ color: '#ff2d2d' });

// ── El Prisma (GDD §15.4, Fase B3): núcleo con el color del arma activa ────

/**
 * Núcleo del Prisma: MUTABLE (color actualizado cada frame según el arma
 * activa/telegraph de cambio, ver EnemyViews.tsx), mismo criterio que
 * `heroMaterial` — un único Prisma vivo a la vez, así que es seguro mutar el
 * material compartido en vez de recrearlo. Arranca en el color de "cuerpo"
 * (mismo mapeo que `WEAPON_COLOR` del héroe: instantáneo arma↔color).
 */
export const prismaCoreMaterial = new THREE.MeshLambertMaterial({ color: WEAPON_COLOR.body.clone() });
/** Gemas orbitantes del Prisma (silueta propia, GDD §15.4): tono neutro cristalino, no compite con el color del núcleo. */
export const prismaGemMaterial = new THREE.MeshLambertMaterial({ color: '#cbd5f5' });
/**
 * Gema pequeña: octaedro (silueta distinta de los cuernos del Guardián / la
 * corona de la Reina). El chispazo "inmune" (evento 'boss-immune-hit') no
 * necesita material propio: reutiliza el sistema de partículas genérico vía
 * `burstTable.ts` (blanco, barato), sin tocar EnemyViews.
 */
export const prismaGemGeometry = new THREE.OctahedronGeometry(0.22);

// ── La Tormenta (GDD §15.5, Fase B4): cuerpo tormentoso + halo de patrón ───

/** Cuerpo de La Tormenta: gris-azulado tormentoso, distinto de la piedra del Guardián, el violeta-verdoso de la Reina y el núcleo mutable del Prisma. */
export const stormBodyMaterial = new THREE.MeshLambertMaterial({ color: '#3a4a63' });
/**
 * Pose de recarga (GDD §15.5: "aviso visual claro" de la ventana de
 * vulnerabilidad): sustituye al cuerpo entero por un tono pálido/apagado
 * mientras `bossStage===STORM_STAGE_RELOAD` — inconfundible frente al
 * gris-azulado tormentoso normal, mismo criterio de intercambio de material
 * que `guardianTelegraphGlowMaterial`.
 */
export const stormReloadCoreMaterial = new THREE.MeshBasicMaterial({ color: '#dce8f2' });
/**
 * Halo "anillo de Saturno segmentado" que envuelve el cuerpo (silueta de "ojo
 * de la tormenta", distinta de cuernos/corona/gemas del resto de jefes).
 * Rediseño post-playtest 2026-07-15 (David: "haría que el anillo fuera
 * siempre como el anillo de Saturno, en horizontal, y que se iluminara por
 * partes... de la forma en la que van a salir las bolas"): el toro-arco
 * giratorio anterior se leía INCLINADO/verticalizado en playtest (causa
 * raíz: combinar una `rotation-x` estática con una `rotation.y` mutada cada
 * frame en el MISMO mesh compone en espacio de Euler local, y NO equivale a
 * "girar un anillo plano sobre su propio eje" — ver comentario largo en
 * `EnemyViews.tsx::applyStormHaloMotion`, ahora eliminado). El nuevo diseño
 * NUNCA rota el mesh tras montarlo: `STORM_HALO_SEGMENTS` copias
 * INSTANCIADAS de un pequeño arco, cada una en un ángulo FIJO de un grid
 * (`i · 2π/N`), con la geometría pre-rotada UNA vez (`rotateZ`+`rotateX`, ver
 * abajo) para quedar SIEMPRE plana en el plano horizontal (XZ) — "cuál
 * sección se ilumina" se decide en `EnemyViews.tsx` mutando SOLO el color por
 * instancia cada frame (mismo patrón `setColorAt`/`instanceColor` que
 * `TrailView.tsx`/`ParticleView.tsx`), nunca la rotación: cero riesgo de
 * cabeceo, sea cual sea el patrón telegrafiado.
 */
export const STORM_HALO_SEGMENTS = 32;
/**
 * Fracción del paso angular del grid (2π/32) que ocupa el arco visible de cada
 * sección. Playtest 2026-07-15 (David: "haz que los segmentos del anillo
 * estén unidos, que no se vea separación entre ellos"): antes 0.7 dejaba un
 * hueco real entre secciones contiguas (se leían como "cuentas" separadas);
 * ahora 1.02 cubre el paso completo con un pelín de solape (2%) que mata el
 * aliasing de la costura entre dos secciones adyacentes sin acumularse en un
 * salto visible — cada sección se centra en su propio ángulo de grid fijo
 * (`i · 2π/32`, ver `rotateZ` de abajo), así que el solape es siempre local a
 * cada costura, nunca una deriva que crezca vuelta tras vuelta. El anillo
 * ahora se lee como una cinta continua; lo que cambia por tramos es el color/
 * brillo (`setColorAt` en EnemyViews.tsx), no la geometría.
 */
const STORM_HALO_SEGMENT_FILL = 1.02;
/** Ángulo (rad) del arco visible de una sola sección instanciada. */
const STORM_HALO_SEGMENT_ARC = ((Math.PI * 2) / STORM_HALO_SEGMENTS) * STORM_HALO_SEGMENT_FILL;
/**
 * Geometría de UNA sección del anillo, pre-rotada dos veces al crearla (coste
 * único, cero por frame):
 * 1. `rotateZ(-arc/2)` centra el arco en el ángulo local 0 (por defecto
 *    `TorusGeometry` empieza su arco en 0 y crece hasta `arc`).
 * 2. `rotateX(π/2)` tumba el anillo (por defecto en el plano XY, "de pie"
 *    mirando a cámara) al plano XZ horizontal (estilo anillo de Saturno).
 * Con esto, el CENTRO visual del arco queda en el ángulo de mundo 0 cuando la
 * instancia no lleva ninguna rotación extra — cada instancia solo necesita UN
 * `rotation.y` para colocarse en su sección del grid (ver EnemyViews.tsx).
 */
export const stormHaloSegmentGeometry = new THREE.TorusGeometry(1, 0.09, 6, 4, STORM_HALO_SEGMENT_ARC);
stormHaloSegmentGeometry.rotateZ(-STORM_HALO_SEGMENT_ARC / 2);
stormHaloSegmentGeometry.rotateX(Math.PI / 2);
/**
 * Material compartido del `InstancedMesh` del halo: MUTABLE (opacidad global
 * actualizada cada frame según la fase del ciclo, ver EnemyViews.tsx), mismo
 * criterio que `prismaCoreMaterial` — un único jefe La Tormenta vivo a la
 * vez. `color` en blanco A PROPÓSITO: el tono real de cada sección lo aporta
 * `instanceColor` (mutado por instancia en EnemyViews.tsx); un material.color
 * no-blanco lo multiplicaría y ensuciaría el color de todas las secciones por
 * igual.
 */
export const stormHaloMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});
/**
 * Tinte verdoso de "ventana de recarga abierta" (mismo verde que
 * `bossVulnerableMaterial`, GDD §15.5): en la 1ª mitad de la recarga TODAS
 * las secciones lo llevan uniforme (anillo verde sólido); en la 2ª mitad las
 * secciones se van fundiendo desde este verde hacia el color resuelto
 * (iluminada/apagada) del próximo patrón — mientras la ventana siga abierta
 * el halo nunca pierde del todo este tinte (EnemyViews.tsx).
 */
export const stormHaloReloadColor = new THREE.Color('#4dd68a');
/**
 * Tinte de SECCIÓN ILUMINADA (por ahí van a salir balas), índice =
 * STORM_PATTERN_* (machine-constants.ts): espiral/anillos comparten el azul
 * base del halo (su lectura ahora es puramente espacial — qué secciones se
 * iluminan —, no hace falta un cuarto color que distinguir); la ráfaga usa un
 * ámbar propio, de alerta, porque es el patrón más súbito (sin fase EXECUTE
 * propia: telegrafía y dispara).
 */
export const STORM_HALO_PATTERN_COLOR: readonly [THREE.Color, THREE.Color, THREE.Color] = [
  new THREE.Color('#8fd8ff'),
  new THREE.Color('#8fd8ff'),
  new THREE.Color('#ffb37a'),
];
/** Tinte de SECCIÓN APAGADA (zona segura, sin balas): gris-azulado oscuro y neutro, para que las secciones iluminadas destaquen con claridad. */
export const STORM_HALO_DIM_COLOR = new THREE.Color('#1b2530');

// ── Personalidad de enemigos (punto 11 de playtest): geometrías/materiales
// compartidos para micro-detalles por arquetipo, sin tocar la sim ni la
// silueta/color de contrato del GDD. ──────────────────────────────────────

/** Pupila/iris oscuro: ojos de la Lacrimera (trail). */
export const eyePupilMaterial = new THREE.MeshBasicMaterial({ color: '#12131c' });
/** Gota de baba del Trail: mismo verde que su cuerpo, algo más oscuro. */
export const trailDripMaterial = new THREE.MeshBasicMaterial({
  color: '#2f9464',
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
});

/** Esfera pequeña para ojos/pupilas/gotas (radio unitario, se escala en el componente). */
export const smallDotGeometry = new THREE.SphereGeometry(1, 10, 8);

// ── Proyectiles ────────────────────────────────────────────────────────────

// Colores alineados con los botones de arma del HUD (mapeo instantáneo
// botón↔proyectil, feedback de playtest): flecha amarilla, hechizo violeta.
export const arrowMaterial = new THREE.MeshLambertMaterial({ color: '#54c7ff' });
/** Asta de la flecha (detrás del cono dominante): tono más oscuro, silueta de flecha reconocible. */
export const arrowTipMaterial = new THREE.MeshLambertMaterial({ color: '#1f6fa1' });
/** Zigzag eléctrico del hechizo (ronda 3, punto 11: sin núcleo, solo rayo): violeta más saturado/luminoso que el cuerpo. */
export const spellBoltMaterial = new THREE.MeshBasicMaterial({
  color: '#c084fc',
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
});
/** Chispas violetas de la estela del hechizo. */
export const spellSparkMaterial = new THREE.MeshBasicMaterial({
  color: '#e9d5ff',
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
});
export const enemyProjectileMaterial = new THREE.MeshLambertMaterial({ color: '#ff3b3b' });

/**
 * Tinte de proyectil enemigo por `Projectile.colorTag` (rama `estilo-oscuro`,
 * feedback playtest 2026-07-17: "que cada bola tuviera su luz" + "un color
 * por ataque" en La Tormenta; "los ataques de proyectiles de su color" en el
 * Prisma). Un `MeshLambertMaterial`/`MeshBasicMaterial` FIJO por etiqueta —
 * NUNCA se muta el `.color` de un material compartido en tiempo de render
 * (`enemyProjectileMaterial` lo usan a la vez TODOS los slots del pool;
 * tocar su color afectaría a cualquier otro proyectil enemigo en pantalla,
 * no solo al propio). `ProjectileView.tsx` REASIGNA la referencia
 * `mesh.material` cada frame según `p.colorTag` (mismo truco de swap que el
 * flash de golpe en `EnemyViews.tsx`), cero asignaciones nuevas por frame.
 *
 * Colores de La Tormenta (GDD §15.5, un color por patrón, "que se lean
 * distintos en la oscuridad"): espiral=violeta, anillos=azul hielo,
 * ráfaga=ámbar — ninguno coincide con `WEAPON_COLOR.arrow`/`.spell` del
 * héroe, para no confundir "mi disparo" con "el suyo". El Prisma (GDD §15.4)
 * reutiliza directamente `WEAPON_COLOR` (mismo mapeo arma↔color que
 * `prismaCoreMaterial`/`prismaWeaponColor` en `EnemyViews.tsx`): sus
 * proyectiles se tiñen del color de su gate activo.
 */
const STORM_SPIRAL_PROJECTILE_COLOR = '#b18cff';
const STORM_RINGS_PROJECTILE_COLOR = '#7cc7ff';
const STORM_BURST_PROJECTILE_COLOR = '#ffb36b';

const enemyProjectileTintMaterials: Record<string, THREE.MeshLambertMaterial> = {
  ram: new THREE.MeshLambertMaterial({ color: WEAPON_COLOR.body.clone() }),
  arrow: new THREE.MeshLambertMaterial({ color: WEAPON_COLOR.arrow.clone() }),
  spell: new THREE.MeshLambertMaterial({ color: WEAPON_COLOR.spell.clone() }),
  'storm-spiral': new THREE.MeshLambertMaterial({ color: STORM_SPIRAL_PROJECTILE_COLOR }),
  'storm-rings': new THREE.MeshLambertMaterial({ color: STORM_RINGS_PROJECTILE_COLOR }),
  'storm-burst': new THREE.MeshLambertMaterial({ color: STORM_BURST_PROJECTILE_COLOR }),
};

/** Material de CUERPO del proyectil enemigo para su `colorTag` ('' u otra etiqueta sin mapear = clásico rojo). */
export function enemyProjectileMaterialForTag(colorTag: string): THREE.MeshLambertMaterial {
  return enemyProjectileTintMaterials[colorTag] ?? enemyProjectileMaterial;
}

/**
 * Halo aditivo bajo cada proyectil enemigo, con el mismo color que el tinte
 * de cuerpo de arriba: generalizado a TODO proyectil enemigo (no solo los de
 * La Tormenta), el shooter clásico (sin `colorTag`) recibe el halo rojo por
 * defecto. Migrado a `glowPuddleMaterial` (cacheado por color+opacidad, ver
 * arriba) — mismos colores/opacidades exactos que antes, sin construir el
 * `MeshBasicMaterial` a mano por etiqueta.
 */
const enemyProjectileGlowHaloMaterials: Record<string, THREE.MeshBasicMaterial> = {
  '': glowPuddleMaterial('#ff3b3b', 0.16),
  ram: glowPuddleMaterial(WEAPON_COLOR.body, 0.16),
  arrow: glowPuddleMaterial(WEAPON_COLOR.arrow, 0.16),
  spell: glowPuddleMaterial(WEAPON_COLOR.spell, 0.16),
  'storm-spiral': glowPuddleMaterial(STORM_SPIRAL_PROJECTILE_COLOR, 0.18),
  'storm-rings': glowPuddleMaterial(STORM_RINGS_PROJECTILE_COLOR, 0.18),
  'storm-burst': glowPuddleMaterial(STORM_BURST_PROJECTILE_COLOR, 0.18),
};

/** Material de HALO del proyectil enemigo para su `colorTag` ('' u otra etiqueta sin mapear = clásico rojo). */
export function enemyProjectileGlowHaloMaterialForTag(colorTag: string): THREE.MeshBasicMaterial {
  return enemyProjectileGlowHaloMaterials[colorTag] ?? enemyProjectileGlowHaloMaterials[''];
}

// ── Hazards ────────────────────────────────────────────────────────────────

/**
 * Foso: negro casi absoluto (agujero), inconfundible contra el suelo claro
 * por sí solo (ronda 3, punto 6: sin reborde — ver HazardView.tsx `PitQuad`).
 */
export const pitMaterial = new THREE.MeshBasicMaterial({ color: '#010102' });
export const spikesMaterial = new THREE.MeshLambertMaterial({ color: '#8d94ad' });
/** Agujas del campo de pinchos: metálico/hueso claro, contraste fuerte con el suelo (punto 1 de playtest). */
export const spikesNeedleMaterial = new THREE.MeshLambertMaterial({ color: '#e7e4d8' });
export const barrelMaterial = new THREE.MeshLambertMaterial({ color: '#c0442b' });
/** Aros metálicos del barril (silueta de barril reconocible). */
export const barrelHoopMaterial = new THREE.MeshLambertMaterial({ color: '#e8d9a0' });
/** Mancha chamuscada que queda tras explotar un barril. */
export const scorchMaterial = new THREE.MeshBasicMaterial({
  color: '#0a0a0f',
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});
export const mudMaterial = new THREE.MeshBasicMaterial({
  color: '#6b4a2f',
  transparent: true,
  opacity: 0.85,
});
export const boostMaterial = new THREE.MeshBasicMaterial({
  color: '#3fd0ff',
  transparent: true,
  opacity: 0.6,
});
export const puddleMaterial = new THREE.MeshBasicMaterial({
  color: '#4dd68a',
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});

// ── Objetos (puntos 9 y 10 de playtest: moneda-moneda, poción-frasco) ─────

export const coinMaterial = new THREE.MeshLambertMaterial({ color: '#ffd166' });
/** Canto de la moneda: tono algo más oscuro, para que se note el volumen al girar. */
export const coinRimMaterial = new THREE.MeshLambertMaterial({ color: '#c98f1b' });
export const potionMaterial = new THREE.MeshLambertMaterial({ color: '#ff6bcb' });
/** Cuello/tapón del frasco de poción: vidrio/corcho más oscuro que el cuerpo. */
export const potionCapMaterial = new THREE.MeshLambertMaterial({ color: '#7a1f4d' });
export const keyMaterial = new THREE.MeshLambertMaterial({ color: '#ffe082' });

/**
 * Tendero placeholder de la sala de tienda (docs/plans/ECONOMY_PLAN.md F4):
 * visual mínimo (túnica cónica + cabeza) a propósito — el feedback fino de
 * personajes llega en F5, esto solo necesita ser legible como NPC.
 */
export const shopkeeperRobeMaterial = new THREE.MeshLambertMaterial({ color: '#7bd88f' });
export const shopkeeperHeadMaterial = new THREE.MeshLambertMaterial({ color: '#e8c39e' });

/** Moneda: cilindro plano (diámetro 1, canto 0.16) — se escala por el radio deseado en el componente. */
export const coinGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.16, 20);
/** Cuerpo bulboso del frasco de poción: esfera achatada verticalmente. */
export const potionBodyGeometry = new THREE.SphereGeometry(1, 16, 12);
/** Cuello fino del frasco. */
export const potionNeckGeometry = new THREE.CylinderGeometry(0.3, 0.38, 1, 12);
/** Tapón/corcho en la boca del frasco. */
export const potionCapGeometry = new THREE.CylinderGeometry(0.4, 0.36, 1, 12);
