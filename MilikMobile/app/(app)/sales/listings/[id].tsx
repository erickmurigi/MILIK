import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import api from '../../../../services/api';
import MilikLoader from '../../../../components/ui/MilikLoader';
import { ErrorBanner, ErrorState } from '../../../../components/ui/PmsStates';
import { useSaleSettings } from '../../../../hooks/useSaleSettings';
import { fmtDate, fmtKES, fmtNumber } from '../../../../utils/pmsFormat';
import { LISTING_STATUS_STYLE, SBG, SC, humanize, refName, saleError } from '../../../../utils/sales';

type Icon = React.ComponentProps<typeof Ionicons>['name'];

type Listing = {
  _id:            string;
  listingNumber?: string;
  title:          string;
  propertyType?:  string;
  description?:   string;
  size?:          number | null;
  sizeUnit?:      string;
  location?:      string;
  town?:          string;
  county?:        string;
  askingPrice:    number;
  negotiable?:    boolean;
  status:         string;
  titleDeedAvailable?: boolean;
  titleDeedNumber?: string;
  amenities?:     string[];
  unitNumber?:    string;
  block?:         string;
  listedDate?:    string;
  notes?:         string;
  project?:       { name?: string; projectNumber?: string } | null;
  effectiveAgent?: { fullName?: string; phone?: string } | null;
  agentInherited?: boolean;
};

export default function ListingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { terms: T } = useSaleSettings();

  const [listing,    setListing]    = useState<Listing | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const reqRef = useRef(0);
  const termRef = useRef(T);
  termRef.current = T;

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    const rid = ++reqRef.current;
    if (mode === 'initial') setLoading(true); else setRefreshing(true);
    try {
      const { data } = await api.get(`/sale/listings/${id}`);
      if (rid !== reqRef.current) return;
      setListing(data);
      setError(null);
    } catch (e) {
      if (rid !== reqRef.current) return;
      setError(saleError(e, `Could not load this ${termRef.current.saleListing.toLowerCase()}.`));
    } finally {
      if (rid === reqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [id]);

  useEffect(() => { load('initial'); }, [load]);

  if (loading && !listing) return <MilikLoader fullscreen />;
  if (!listing) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ErrorState message={error || `Could not load this ${T.saleListing.toLowerCase()}.`} onRetry={() => load('initial')} />
      </SafeAreaView>
    );
  }

  const sc    = LISTING_STATUS_STYLE[listing.status] ?? LISTING_STATUS_STYLE.available;
  const place = [listing.location, listing.town, listing.county].filter(Boolean).join(', ');
  const agent = refName(listing.effectiveAgent, 'fullName');
  const unit  = [listing.unitNumber ? `${T.saleUnit} ${listing.unitNumber}` : '', listing.block ? `Block ${listing.block}` : ''].filter(Boolean).join(' · ');
  const amenities = (listing.amenities ?? []).filter(Boolean);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={SC} />}
      >
        {/* a refresh that failed keeps the old data on screen, so say so */}
        {error ? <View style={{ marginHorizontal: -16 }}><ErrorBanner message={error} onRetry={() => load('refresh')} /></View> : null}

        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              {listing.listingNumber ? <Text style={styles.heroNum}>{listing.listingNumber}</Text> : null}
              <Text style={styles.heroTitle}>{listing.title}</Text>
              {place ? <Text style={styles.heroLoc}>{place}</Text> : null}
            </View>
            <View style={[styles.badge, { backgroundColor: '#fff' }]}>
              <Text style={[styles.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>
          <Text style={styles.heroLbl}>Asking price</Text>
          <Text style={styles.heroPrice} numberOfLines={1} adjustsFontSizeToFit>{fmtKES(listing.askingPrice)}</Text>
          {listing.negotiable ? <Text style={styles.heroLoc}>Negotiable</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>DETAILS</Text>
          {listing.propertyType ? <InfoRow icon="pricetag-outline" label="Type" value={humanize(listing.propertyType)} /> : null}
          {listing.project?.name ? <InfoRow icon="business-outline" label={T.saleProject} value={listing.project.name} /> : null}
          {unit ? <InfoRow icon="grid-outline" label={T.saleUnit} value={unit} /> : null}
          {listing.size ? <InfoRow icon="resize-outline" label="Size" value={`${fmtNumber(listing.size)} ${listing.sizeUnit ?? 'sqm'}`} /> : null}
          <InfoRow icon="document-text-outline" label="Title deed" value={listing.titleDeedAvailable ? (listing.titleDeedNumber || 'Available') : 'Not available'} />
          {agent ? <InfoRow icon="person-outline" label={T.saleAgent} value={`${agent}${listing.agentInherited ? ` (from ${T.saleProject.toLowerCase()})` : ''}`} /> : null}
          {listing.listedDate ? <InfoRow icon="calendar-outline" label="Listed" value={fmtDate(listing.listedDate)} /> : null}
          {listing.description ? <InfoRow icon="reader-outline" label="Description" value={listing.description} /> : null}
          {listing.notes ? <InfoRow icon="create-outline" label="Notes" value={listing.notes} /> : null}
        </View>

        {amenities.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>AMENITIES</Text>
            <View style={styles.chipWrap}>
              {amenities.map(a => (
                <View key={a} style={styles.chip}><Text style={styles.chipTxt}>{a}</Text></View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value }: { icon: Icon; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={14} color="#94A3B8" style={{ marginTop: 1 }} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: SBG },
  scroll: { padding: 16, gap: 14, paddingBottom: 32 },

  hero: {
    backgroundColor: SC, borderRadius: 18, padding: 20, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  heroTop:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  heroNum:   { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.8, marginBottom: 2 },
  heroTitle: { fontSize: 20, fontWeight: '900', color: '#fff' },
  heroLoc:   { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  heroLbl:   { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.55)', marginTop: 8, letterSpacing: 0.6 },
  heroPrice: { fontSize: 26, fontWeight: '900', color: '#fff' },
  badge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  badgeTxt:  { fontSize: 11, fontWeight: '800' },

  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, gap: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: '#94A3B8' },

  infoRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoLabel: { fontSize: 12, color: '#94A3B8', width: 96 },
  infoValue: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0F172A' },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:     { backgroundColor: '#F1F5F9', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  chipTxt:  { fontSize: 12, fontWeight: '600', color: '#475569' },
});
