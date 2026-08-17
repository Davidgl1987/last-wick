/**
 * Objetos recogibles (GDD §9): moneda, poción, llave. Recogida por contacto
 * simple círculo-círculo contra el héroe; los enemigos también sueltan
 * monedas al morir (ver `dropCoinAt`, invocado desde step.ts al detectar
 * enemy.hp <= 0 recién cruzado a través del evento 'enemy-died').
 */

import {
  COIN_DROP_MIN_SEPARATION,
  COIN_DROP_PLACEMENT_ATTEMPTS,
  COIN_MAGNET_RADIUS_BY_LEVEL,
  COIN_MAGNET_SPEED,
  ITEM_PICKUP_RADIUS,
  POTION_HEAL,
} from './constants';
import { pushEvent, type EventQueue } from '@/engine/events';
import type { Item, World } from '@/game/world/types';

/** Distancia a la moneda ACTIVA más cercana (`Infinity` si no hay ninguna). */
function distanceToNearestActiveCoin(world: World, x: number, y: number): number {
  let nearest = Infinity;
  for (let i = 0; i < world.items.length; i++) {
    const item = world.items[i];
    if (!item.active || item.kind !== 'coin') continue;
    const dist = Math.hypot(item.position.x - x, item.position.y - y);
    if (dist < nearest) nearest = dist;
  }
  return nearest;
}

/**
 * Reubica `(x, y)` si cae demasiado cerca de otra moneda ya activa (playtest
 * 2026-08-14: "las monedas no deberían salir tan juntas como para que se
 * superpongan" — varios enemigos muriendo a la vez, o un jefe soltando
 * `COIN_DROPS_BY_KIND.boss` monedas de golpe, ver step.ts `collectDeadDrops`,
 * piden posiciones casi coincidentes al ser cada ángulo/radio un sorteo
 * independiente).
 *
 * Prueba puntos alternativos alrededor del punto pedido, en un anillo de
 * radio creciente por intento y ángulo aleatorio (determinista vía
 * `world.rng`, igual que el resto de la sim — nunca `Math.random`). Acotado a
 * `COIN_DROP_PLACEMENT_ATTEMPTS`: si ninguno alcanza la separación mínima
 * (sala/esquina abarrotada de drops), se queda con el MEJOR candidato visto
 * (mayor distancia a la moneda más cercana), nunca reintenta sin límite —
 * mismo criterio que `PLACEMENT_ATTEMPTS` en room-props.ts.
 */
function separateCoinDrop(world: World, x: number, y: number): { x: number; y: number } {
  let bestX = x;
  let bestY = y;
  let bestDist = distanceToNearestActiveCoin(world, x, y);
  for (let attempt = 0; attempt < COIN_DROP_PLACEMENT_ATTEMPTS && bestDist < COIN_DROP_MIN_SEPARATION; attempt++) {
    const angle = world.rng() * Math.PI * 2;
    const spread = COIN_DROP_MIN_SEPARATION * (1 + attempt * 0.5);
    const cx = x + Math.cos(angle) * spread;
    const cy = y + Math.sin(angle) * spread;
    const dist = distanceToNearestActiveCoin(world, cx, cy);
    if (dist > bestDist) {
      bestDist = dist;
      bestX = cx;
      bestY = cy;
    }
  }
  return { x: bestX, y: bestY };
}

/** Activa una moneda suelta en la posición dada (drop de enemigo). Reutiliza el pool de items si hay slots inactivos, si no, añade uno nuevo (los drops son eventos raros, no hot path de 60Hz). */
export function dropCoinAt(world: World, x: number, y: number): void {
  const pos = separateCoinDrop(world, x, y);
  for (let i = 0; i < world.items.length; i++) {
    const item = world.items[i];
    if (!item.active && item.kind === 'coin') {
      item.active = true;
      item.position.x = pos.x;
      item.position.y = pos.y;
      return;
    }
  }
  world.items.push({
    id: `coin-drop-${world.items.length}-${Math.floor(world.time * 1000)}`,
    kind: 'coin',
    position: { x: pos.x, y: pos.y },
    active: true,
  });
}

/**
 * Activa una poción suelta en la posición dada (GDD §15.2: el Guardián suelta
 * una al cruzar a fase 2 y a fase 3). Mismo patrón que `dropCoinAt`: reutiliza
 * un slot inactivo del pool de items si lo hay, si no añade uno nuevo (evento
 * raro, no hot path).
 */
export function dropPotionAt(world: World, x: number, y: number): void {
  for (let i = 0; i < world.items.length; i++) {
    const item = world.items[i];
    if (!item.active && item.kind === 'potion') {
      item.active = true;
      item.position.x = x;
      item.position.y = y;
      return;
    }
  }
  world.items.push({
    id: `potion-drop-${world.items.length}-${Math.floor(world.time * 1000)}`,
    kind: 'potion',
    position: { x, y },
    active: true,
  });
}

function tryPickup(world: World, item: Item, events: EventQueue): void {
  const hero = world.hero;
  const dx = hero.position.x - item.position.x;
  const dy = hero.position.y - item.position.y;
  const rr = hero.radius + ITEM_PICKUP_RADIUS;
  if (dx * dx + dy * dy > rr * rr) return;

  item.active = false;
  switch (item.kind) {
    case 'coin':
      world.stats.coinsCollected += 1;
      world.stats.score += 1;
      hero.coins += 1;
      break;
    case 'potion':
      hero.hp = Math.min(hero.maxHp, hero.hp + POTION_HEAL);
      break;
    case 'key':
      hero.hasKey = true;
      break;
    case 'shopkeeper':
      // No se recoge: el contacto con el tendero se resuelve en
      // `stepShopkeeperContact` (stepItems lo desvía ahí para este kind,
      // nunca llega a tryPickup).
      break;
  }
  // label = tipo de objeto ('coin'/'potion'/'key'): permite a effects/HUD dar
  // feedback de color propio (dorado/rosa/azul) sin tener que re-derivarlo.
  pushEvent(events, 'item-pickup', item.position.x, item.position.y, 1, item.kind);
}

/**
 * Contacto con el tendero de la tienda (docs/plans/ECONOMY_PLAN.md F4): al
 * tocarlo en fase 'playing' abre la fase 'shopping' (ShopModal, GameRoot) y
 * emite 'shop-opened'. El item NUNCA se desactiva (no es recogible, es
 * reabrible el resto de la mazmorra).
 *
 * Anti-reapertura instantánea: `world.shopGreeterArmed` se pone a false al
 * abrir y solo vuelve a true cuando el héroe SALE del radio de contacto —
 * así cerrar la tienda con el héroe aún pegado al tendero no la reabre en el
 * mismo tick. Vive fuera de `tryPickup` (en vez de resolverse dentro de su
 * `case 'shopkeeper'`) porque `tryPickup` retorna pronto fuera de alcance y
 * este contacto necesita actuar también en ese caso (para rearmar el flag);
 * reutiliza el mismo radio de contacto (`rr`) que el resto de items.
 */
function stepShopkeeperContact(world: World, item: Item, events: EventQueue): void {
  const hero = world.hero;
  const dx = hero.position.x - item.position.x;
  const dy = hero.position.y - item.position.y;
  const rr = hero.radius + ITEM_PICKUP_RADIUS;
  const inContact = dx * dx + dy * dy <= rr * rr;

  if (!inContact) {
    world.shopGreeterArmed = true;
    return;
  }
  if (world.phase === 'playing' && world.shopGreeterArmed) {
    world.shopGreeterArmed = false;
    world.phase = 'shopping';
    pushEvent(events, 'shop-opened', item.position.x, item.position.y, 1);
  }
}

/**
 * Imán de monedas (Canto de Urraca, docs/plans/ECONOMY_PLAN.md F2): si el
 * héroe tiene `coinMagnetLevel > 0`, acerca la moneda a velocidad constante
 * `COIN_MAGNET_SPEED` cuando está dentro del radio de su nivel
 * (`COIN_MAGNET_RADIUS_BY_LEVEL`). Clampa el paso para no pasarse de largo
 * del héroe; la recogida real sigue ocurriendo en `tryPickup` por contacto
 * normal cuando la moneda llega.
 */
function stepCoinMagnet(world: World, item: Item, dt: number): void {
  const hero = world.hero;
  const level = Math.min(hero.modifiers.coinMagnetLevel, COIN_MAGNET_RADIUS_BY_LEVEL.length - 1);
  if (level <= 0) return;
  const radius = COIN_MAGNET_RADIUS_BY_LEVEL[level];

  const dx = hero.position.x - item.position.x;
  const dy = hero.position.y - item.position.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-6 || dist > radius) return;

  const step = Math.min(dist, COIN_MAGNET_SPEED * dt);
  item.position.x += (dx / dist) * step;
  item.position.y += (dy / dist) * step;
}

/** Recorre los items activos de la sala y resuelve recogida por contacto con el héroe (con imán de monedas, si el héroe lo tiene). */
export function stepItems(world: World, dt: number, events: EventQueue): void {
  const items = world.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.active) continue;
    if (item.kind === 'shopkeeper') {
      stepShopkeeperContact(world, item, events);
      continue;
    }
    if (item.kind === 'coin') stepCoinMagnet(world, item, dt);
    tryPickup(world, item, events);
  }
}
