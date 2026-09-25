import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

/** Full-area error message with a Retry button (used when a list/screen failed to load). */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="cloud-offline-outline" size={44} color={Colors.border} />
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity style={styles.btn} onPress={onRetry} activeOpacity={0.8}>
          <Ionicons name="refresh-outline" size={15} color={Colors.white} />
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** Slim banner shown above a list that already has rows when a refresh failed. */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <TouchableOpacity style={styles.banner} onPress={onRetry} activeOpacity={0.8}>
      <Ionicons name="alert-circle-outline" size={16} color={Colors.danger} />
      <Text style={styles.bannerText} numberOfLines={2}>{message}</Text>
      {onRetry ? <Text style={styles.bannerRetry}>Retry</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  text: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 10,
    paddingHorizontal: 18, paddingVertical: 10,
  },
  btnText: { color: Colors.white, fontSize: 13, fontWeight: '700' },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 8, padding: 10,
    backgroundColor: Colors.dangerLight, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.danger + '40',
  },
  bannerText: { flex: 1, fontSize: 12, color: Colors.danger },
  bannerRetry: { fontSize: 12, fontWeight: '800', color: Colors.danger },
});
