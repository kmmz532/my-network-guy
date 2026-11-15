// オフィスの設備と操作（N126）。外部への接続・サーバーの貸し出し・プリンターの効果・床の変更を、自社の情報から移した画面
import { useState, type ReactNode } from 'react';
import { balance } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { levelOf } from '../sim/level';
import { useGameStore } from '../stores/useGameStore';
import { outsideCheck, rentalOf } from '../network/external';
import { gameEnv } from '../sim/env';
import { printerArrivalBonusOf } from '../sim/backOffice';
import { floorOfRoom, roomTileCount } from '../sim/office';
import { officeUplinkOf, type RoomId } from '../sim/project';
import type { FloorId } from '../data/schema';
import { Button } from './ui/Button';
import { Section } from './ui/Section';
import { Select } from './ui/Select';
import { Text } from './ui/Text';
import { deviceCategory } from '../registry/query';

// 左に項目、右に値や操作を置く行。下に区切りの線を引く
function Line({ children }: { children: ReactNode }) {
  return (
    <Section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>{children}</div>
    </Section>
  );
}

export function OfficeBody() {
  const office = useGameStore((s) => s.office);
  const companyExp = useGameStore((s) => s.companyExp);
  const level = levelOf(companyExp, balance);
  // 自社のネットワークの外部への接続と、サーバーの貸し出し（N71・N72）
  const outside = outsideCheck(office, gameEnv.engine);
  const rental = rentalOf(office, gameEnv.engine, balance.rental, level, balance.time.daysPerMonth);
  // プリンターが営業の依頼に足す確率（N98）
  const printerBonus = useGameStore((s) => printerArrivalBonusOf(s.office, (d) => deviceCategory(d) === 'printer', balance));
  const uplink = officeUplinkOf(office);
  const setPlacing = useGameStore((s) => s.setPlacing);
  return (
    <div style={{ padding: 12 }}>
      <Text>
      {/* 回線終端。解放のレベルに届いてから、置き場所を選んで置く。置いた後は有料で位置を変更できる */}
      {level >= balance.featureUnlocks.uplink && (
        <Line>
          <span>{t('ui.company.uplink')}</span>
          <Button variant="secondary" size="fit" onClick={() => setPlacing('uplink')}>
            {uplink ? t('ui.company.uplink.move', { cost: balance.office.uplinkMoveCost.toLocaleString('ja-JP') }) : t('ui.company.uplink.place')}
          </Button>
        </Line>
      )}
      <Line>
        <span>{t('ui.company.outside')}</span>
        <span>{!outside.attached ? t('ui.company.outside.none') : outside.pcsReachOutside ? t('ui.company.outside.ok') : t('ui.company.outside.ng')}</span>
      </Line>
      {outside.attached && (
        <Line>
          <span>{t('ui.company.rental')}</span>
          <span>{outside.leaks ? t('ui.company.rental.leak') : t('ui.company.rental.value', { count: outside.exposedServers.length, income: rental.monthly.toLocaleString('ja-JP') })}</span>
        </Line>
      )}
      {printerBonus > 0 && (
        <Line>
          <span>{t('ui.company.printer')}</span>
          <span>{t('ui.company.printer.value', { pct: Math.round(printerBonus * 1000) / 10 })}</span>
        </Line>
      )}
      {/* 床（部屋ごとの床の種類）。解禁のレベルに届いてから出す（N92） */}
      {level >= balance.featureUnlocks.floorChange && <FloorRows />}
      </Text>
    </div>
  );
}

// 部屋ごとの床の張り替え（N92）。部屋を選び、床の種類を選ぶ。解禁前の種類は鍵の文字と解禁のレベルを出す
function FloorRows() {
  const office = useGameStore((s) => s.office);
  const level = useGameStore((s) => levelOf(s.companyExp, balance));
  const changeFloor = useGameStore((s) => s.changeFloor);
  const [message, setMessage] = useState<string | null>(null);
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const rooms: RoomId[] = ['main', ...office.annexes];
  return (
    <div style={{ marginTop: 6 }}>
      <Text tone="warn">{t('ui.floor.title')}</Text>
      {rooms.map((room) => {
        const current = floorOfRoom(office, room);
        const tiles = roomTileCount(office, room);
        const options = balance.floors.map((f) => {
          const name = t(`ui.floor.${f.id}` as const);
          if (level < f.unlockLevel) return { value: f.id, label: `${name}（${t('ui.floor.locked', { level: f.unlockLevel })}）` };
          const cost = f.id === current ? '' : office.bought.includes(f.id) ? `（${t('ui.floor.bought')}）` : `（${yen(f.costPerTile * tiles)}円）`;
          return { value: f.id, label: `${name}${cost}` };
        });
        return (
          <div key={room} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <span>{t(`ui.floor.room.${room}` as const)}</span>
            <Select
              label={t(`ui.floor.room.${room}` as const)}
              value={current}
              options={options}
              onChange={(v) => {
                const reason = changeFloor(room, v as FloorId);
                setMessage(reason ? tDyn(`ui.error.${reason}`) : null);
              }}
            />
          </div>
        );
      })}
      {message && <Text tone="warn" size="s">{message}</Text>}
    </div>
  );
}
