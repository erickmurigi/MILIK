import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

type Props = { message: string; onRetry?: () => void };

/** Centered error block with a Retry button — used when a list / detail request fails. */
export default function ListErrorState({ message, onRetry }: Props) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="cloud-offline-outline" size={44} color={Colors.border} />
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity style={styles.btn} onPress={onRetry} activeOpacity={0.8}>
          <Ionicons name="refresh" size={15} color={Colors.white} />
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:    { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 70, paddingHorizontal: 32 },
  text:    { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  btn:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  btnText: { color: Colors.white, fontSize: 13, fontWeight: '700' },
});
