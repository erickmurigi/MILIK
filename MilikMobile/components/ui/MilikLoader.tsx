import { useEffect, useRef } from 'react';
import { View, Image, Animated, StyleSheet, Easing } from 'react-native';
import { Colors } from '../../constants/colors';

type Props = {
  size?:       'large' | 'small';
  fullscreen?: boolean;
};

export default function MilikLoader({ size = 'large', fullscreen = false }: Props) {
  const spin  = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, {
        toValue:         1,
        duration:        900,
        easing:          Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.88, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const rotate   = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const logoSize = size === 'large' ? 48 : 26;
  const ringSize = size === 'large' ? 76 : 44;
  const bw       = size === 'large' ? 3 : 2.5;

  const inner = (
    <View style={{ width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' }}>
      {/* Outer rotating arc */}
      <Animated.View
        style={[
          styles.ring,
          {
            width: ringSize, height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: bw,
            transform: [{ rotate }],
          },
        ]}
      />
      {/* Logo */}
      <Animated.Image
        source={require('../../assets/icon.png')}
        style={[
          styles.logo,
          { width: logoSize, height: logoSize, borderRadius: logoSize * 0.22 },
          { transform: [{ scale: pulse }] },
        ]}
        resizeMode="cover"
      />
    </View>
  );

  if (fullscreen) return <View style={styles.fullscreen}>{inner}</View>;
  return inner;
}

const styles = StyleSheet.create({
  fullscreen: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  ring: {
    position:       'absolute',
    borderColor:    Colors.primary,
    borderTopColor: Colors.accent,
    borderLeftColor:'transparent',
  },
  logo: { position: 'absolute' },
});
