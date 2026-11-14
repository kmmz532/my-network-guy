// IPアドレスとゲートウェイの欄。候補つきの入力欄（ComboBox）を、IP の設定（検証・文言・候補の「使用中」）で使う薄い包み。
import { ComboBox, type ComboBoxProps } from './ui/ComboBox';

export function AddressInput(props: ComboBoxProps) {
  return <ComboBox {...props} />;
}
