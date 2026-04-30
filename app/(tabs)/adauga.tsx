import { View } from 'react-native';

// Placeholder pentru tabul „Adaugă". Listenerul din _layout.tsx previne
// navigarea efectivă către acest ecran și deschide formularul de tranzacție
// nouă pe stack-ul root.
export default function AdaugaPlaceholder() {
  return <View />;
}
