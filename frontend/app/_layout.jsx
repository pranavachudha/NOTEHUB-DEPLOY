import { Slot, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { ActivityIndicator, View, LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

LogBox.ignoreLogs(["Cannot read property 'back'"]);

function RouteGuard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "auth";

    if (!user && !inAuth) {
      router.replace("/auth/login");
    } else if (user && inAuth) {
      router.replace("/tabs/capture");
    }
  }, [user, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0A0A0F", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#F5A623" size="large" />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RouteGuard />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
