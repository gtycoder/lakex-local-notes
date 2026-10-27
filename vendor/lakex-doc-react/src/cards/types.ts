export interface ICardProps<TCardValue = any> {
  editor: any;
  cardValue: TCardValue;
  updateCardValue: (value: TCardValue) => void;
  cardType: 'inline' | 'block';
}