// 表（パケットの中身の欄）。Table は罫線のない表、HeadRow は見出しの行（左寄せ・少し淡い）、Row は本文の行（selected は選んでいる行の地）。
// Cell は 1 つの欄。mark の changed は前の行から変わった値（注意の黄の太字）、warn は注意の黄の文。colSpan で横にまたがる。
import type { ReactNode } from 'react';
import './tokens.css';
import './ui.css';

export function Table({ children }: { children: ReactNode }) {
  return <table className="ui-table">{children}</table>;
}

export function HeadRow({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="ui-table__head">{children}</tr>
    </thead>
  );
}

export function HeadCell({ children }: { children: ReactNode }) {
  return <th>{children}</th>;
}

export function Row({ selected = false, children }: { selected?: boolean; children: ReactNode }) {
  return <tr className={selected ? 'ui-table__row--selected' : undefined}>{children}</tr>;
}

export function Cell({ mark, colSpan, children }: { mark?: 'changed' | 'warn'; colSpan?: number; children: ReactNode }) {
  return (
    <td className={mark ? `ui-table__cell--${mark}` : undefined} colSpan={colSpan}>
      {children}
    </td>
  );
}
