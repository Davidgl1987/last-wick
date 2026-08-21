/**
 * Modal de tienda (docs/plans/ECONOMY_PLAN.md F4, fase 'shopping'): se muestra
 * al tocar al tendero de la sala 'tienda'. Stock fijo de `session.shopStock`
 * (sorteado UNA vez por mazmorra, ver session.ts) con precio del siguiente
 * nivel; comprar llama a `tryPurchaseUpgrade` (descuenta monedas, resta
 * puntuación con clamp a 0 y aplica el nivel, ver session/upgrades.ts).
 * "Salir" cierra la tienda (`closeShop`) sin re-sortear el stock: reabrible
 * el resto de la mazmorra con los niveles ya comprados reflejados.
 *
 * El saldo se lee del store zustand (`coins`, ya sincronizado por
 * useGameLoop en cada frame incluso con la sim pausada): su cambio tras una
 * compra dispara el re-render que refresca precios/pips, leídos directamente
 * de `hero.upgradeLevels` (ya actualizado de forma síncrona por
 * `tryPurchaseUpgrade` en el momento de la compra).
 */

import { closeShop, type GameSession } from '@/game/session/session';
import { canOfferUpgrade, getUpgradeLevel, tryPurchaseUpgrade, type UpgradeDef } from '@/game/session/upgrades';
import { useUiStore } from '@/game/session/store';
import { Button, Modal } from '@/ui';
import { useT } from '@/i18n';
import { UpgradeIcon, UpgradeLevelPips } from './UpgradeIcon';
import './modals.css';

export function ShopModal({ session }: { session: GameSession }) {
  const t = useT();
  const phase = useUiStore((s) => s.phase);
  const coins = useUiStore((s) => s.coins);

  const isOpen = phase === 'shopping';

  const hero = session.world.hero;

  const handleBuy = (def: UpgradeDef) => {
    tryPurchaseUpgrade(session.world, def, session.events);
  };

  const handleExit = () => {
    closeShop(session);
  };

  return (
    <Modal
      open={isOpen}
      className="upgrade-modal shop-modal"
      title={t('shop.title')}
      actions={
        <Button variant="secondary" onClick={handleExit}>
          {t('shop.exit')}
        </Button>
      }
    >
      <p className="shop-balance" aria-label={t('shop.balance', { coins })}>
        <span className="shop-balance-icon" />
        {coins}
      </p>
      <div className="upgrade-cards">
        {session.shopStock.map((def) => {
          const level = getUpgradeLevel(hero, def.id);
          const capped = level >= def.maxLevel;
          // `canOfferUpgrade` cubre maxLevel Y `isAvailable` (ej. Ascua
          // Vital con hp/maxHp ya a tope): más robusto que comparar solo
          // contra maxLevel para decidir si el botón se puede pulsar.
          const offerable = canOfferUpgrade(def, hero);
          const price = def.price(level + 1);
          const affordable = offerable && coins >= price;
          const priceLabel = capped ? t('shop.capped') : offerable ? `${price}` : t('shop.unavailable');
          return (
            <button
              key={def.id}
              type="button"
              className="upgrade-card"
              disabled={!affordable}
              onClick={() => handleBuy(def)}
            >
              <div className="upgrade-card-head">
                <UpgradeIcon icon={def.icon} size={32} />
                <span className="upgrade-card-name">{t(`upgrades.${def.id}.name`)}</span>
              </div>
              <span className="upgrade-card-desc">{t(`upgrades.${def.id}.desc`)}</span>
              <div className="shop-card-footer">
                <UpgradeLevelPips level={level} maxLevel={def.maxLevel} previewLevel={offerable ? level + 1 : level} />
                <span className="shop-card-price">{priceLabel}</span>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
