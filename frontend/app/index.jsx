import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "../context/AuthContext";
import { View, ActivityIndicator } from "react-native";

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready || loading) return;
    if (user) {
      router.replace("/tabs/capture");
    } else {
      router.replace("/auth/login");
    }
  }, [ready, user, loading]);

  return (
    <View style={{ flex: 1, backgroundColor: "#0A0A0F", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color="#F5A623" size="large" />
    </View>
  );
}
