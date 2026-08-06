/**
 * Helper puro (F2, docs/plans/ART_KIT_PLAN.md §2 y §5): cuántos módulos de una
 * pieza modular del kit (`barrier` para los muros; también sirve para
 * cualquier otra pieza que se repita a lo largo de un eje) hacen falta para
 * cubrir un tramo de longitud `length`, y qué factor de escala aplicar a cada
 * módulo en su eje largo para que los `count` módulos cubran ESE tramo
 * EXACTAMENTE.
 *
 * Motivo: los AABB de muro de la mazmorra tienen longitudes fraccionarias
 * (las puertas de `DOOR_WIDTH` recortan el lado, ver
 * `dungeon.ts::buildRoomWallSegments`) que casi nunca son múltiplos exactos
 * de `moduleLength` (3.36 u, el ancho de `barrier` ya escalado — ver
 * `kit.ts::KIT_SCALE`). Sin este ajuste, o bien queda un hueco al final del
 * tramo (colocando módulos a tamaño natural hasta donde alcancen) o hay que
 * fundir/recortar geometría por software — ninguna de las dos opciones vale
 * la pena para un simple sillar.
 *
 * `count = max(1, round(length / moduleLength))`: redondeo normal (ni ceil ni
 * floor) porque un módulo de más o de menos reparte la desviación entre TODOS
 * los módulos del tramo a partes iguales — el estirado/compresión máximo es
 * ±15 % en los tramos más cortos, imperceptible en un sillar (ART_KIT_PLAN
 * §2). `max(1, …)` garantiza que un tramo más corto que un módulo entero
 * (p. ej. el resto de pared junto a una puerta) sigue recibiendo AL MENOS un
 * módulo, nunca cero (cero dejaría un agujero visual en un muro que SÍ
 * colisiona).
 *
 * `scale = length / (count * moduleLength)`: factor a aplicar sobre el eje
 * largo de CADA módulo (multiplica su tamaño natural, ya escalado por
 * `KIT_SCALE`) para que `count * moduleLength * scale === length`
 * exactamente — es la propiedad que testea `wall-modules.test.ts`.
 *
 * PURO a propósito (sin `three`, sin React): se testea en el entorno `node`
 * de vitest, igual que `kit-models.ts`. `RoomView.tsx` es quien lo consume
 * con `moduleLength` = tamaño real medido de `kitGeometry('barrier')` (nunca
 * un `3.36` hardcodeado: si el modelo cambiara de tamaño, este helper sigue
 * siendo correcto sin tocarlo).
 */
export function wallModuleLayout(length: number, moduleLength: number): { count: number; scale: number } {
  const count = Math.max(1, Math.round(length / moduleLength));
  const scale = length / (count * moduleLength);
  return { count, scale };
}

/**
 * Elige, entre dos longitudes de módulo candidatas — la de la familia
 * elegida para la sala (`wall`/`wall_cracked`/`wall_broken`/`wall_arched`,
 * ~3.36 u) y la de `wall_half` (~1.68 u, su hermana de medio tamaño) —, cuál
 * de las dos deja MENOS estirado/compresión al cubrir un tramo de `length`
 * con `wallModuleLayout` (encargo F2 de David, 2026-08-06: "wall_half para
 * tramos cortos"). Un resto de muro junto a una puerta o una esquina rara vez
 * es múltiplo del módulo grande, y a veces el módulo de MEDIO tamaño lo cubre
 * con mucho menos deformación que forzar el módulo grande a encogerse hasta
 * una fracción de su tamaño natural.
 *
 * Devuelve la longitud de módulo elegida, no un nombre de modelo: quien llama
 * (`RoomView.tsx::RoomWalls`) ya sabe qué geometría corresponde a cada una —
 * este helper solo decide CUÁL de las dos encaja mejor, sigue sin saber nada
 * de three.js ni del kit.
 */
export function betterModuleLength(length: number, fullModuleLength: number, halfModuleLength: number): number {
  const fullDeviation = Math.abs(wallModuleLayout(length, fullModuleLength).scale - 1);
  const halfDeviation = Math.abs(wallModuleLayout(length, halfModuleLength).scale - 1);
  return halfDeviation < fullDeviation ? halfModuleLength : fullModuleLength;
}
