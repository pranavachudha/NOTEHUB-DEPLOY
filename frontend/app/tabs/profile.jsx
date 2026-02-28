import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "expo-router";
import { useAppAlert } from "../../components/AppAlert";
import api from "../../services/api";

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const { show, element } = useAppAlert();
  const [stats, setStats] = useState({ docs: 0, photos: 0, words: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    try {
      const res = await api.get("/documents");
      const docs = res.data;
      const totalPhotos = docs.reduce((a, d) => a + (d.image_count || 0), 0);
      const totalWords = docs.reduce((a, d) => d.extracted_text ? a + d.extracted_text.trim().split(/\s+/).filter(Boolean).length : a, 0);
      setStats({ docs: docs.length, photos: totalPhotos, words: totalWords });
    } catch {} finally { setLoadingStats(false); }
  }

  function handleLogout() {
    show("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel", onPress: () => {} },
      { text: "Sign out", style: "destructive", onPress: async () => {
        await logout();
        router.replace("/auth/login");
      }},
    ]);
  }

  const initials = user?.name ? user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() : "?";

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  return (
    <SafeAreaView style={s.container}>
      {element}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Text style={s.screenLabel}>NoteHub</Text>
          <Text style={s.title}>Profile</Text>
        </View>

        <View style={s.card}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 16 }}>
              <Text style={s.name}>{user?.name}</Text>
              <Text style={s.email}>{user?.email}</Text>
              <Text style={s.since}>Member since {formatDate(user?.created_at)}</Text>
            </View>
          </View>
        </View>

        <Text style={s.sectionLabel}>Your Activity</Text>
        {loadingStats ? (
          <ActivityIndicator color="#F5A623" style={{ marginTop: 12 }} />
        ) : (
          <View style={s.statsRow}>
            <StatCard value={stats.docs}   label="Documents" icon="document-text" />
            <StatCard value={stats.photos} label="Photos"    icon="images" />
            <StatCard value={stats.words}  label="Words"     icon="text" />
          </View>
        )}

        <Text style={[s.sectionLabel, { marginTop: 28 }]}>Settings</Text>
        <View style={{ gap: 10, marginTop: 10 }}>
          <MenuItem icon="information-circle-outline" label="About NoteHub" sublabel="Version 1.0.0"
            onPress={() => show("NoteHub", "Capture notes via camera, extract text with OCR, and save as searchable PDFs.")} />
          <MenuItem icon="shield-checkmark-outline" label="Privacy" sublabel="Your data stays on your account"
            onPress={() => show("Privacy", "All your data is stored securely on your personal account and is never shared.")} />
        </View>

        <TouchableOpacity onPress={handleLogout} style={s.logoutBtn}>
          <Ionicons name="log-out-outline" size={20} color="#E85D75" />
          <Text style={s.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ value, label, icon }) {
  return (
    <View style={s.statCard}>
      <Ionicons name={icon} size={22} color="#F5A623" />
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function MenuItem({ icon, label, sublabel, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={s.menuItem}>
      <View style={s.menuIcon}><Ionicons name={icon} size={18} color="#7A6DC4" /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.menuLabel}>{label}</Text>
        {sublabel && <Text style={s.menuSub}>{sublabel}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color="#3D348B" />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  scroll: { paddingHorizontal: 20, paddingBottom: 48 },
  header: { paddingTop: 8, paddingBottom: 20 },
  screenLabel: { fontSize: 11, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 2, marginBottom: 2 },
  title: { fontSize: 28, fontWeight: "bold", color: "#F8F6F0" },
  card: { backgroundColor: "#1E1A4A", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#2D266B", marginBottom: 24 },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: "#3D348B", borderWidth: 3, borderColor: "#F5A623", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#F5A623", fontSize: 24, fontWeight: "bold" },
  name: { color: "#F8F6F0", fontSize: 20, fontWeight: "bold" },
  email: { color: "#7A6DC4", fontSize: 14, marginTop: 2 },
  since: { color: "#4a4460", fontSize: 12, marginTop: 4 },
  sectionLabel: { fontSize: 11, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10 },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, backgroundColor: "#1E1A4A", borderRadius: 16, padding: 16, alignItems: "center", borderWidth: 1, borderColor: "#2D266B" },
  statValue: { color: "#F8F6F0", fontSize: 26, fontWeight: "bold", marginTop: 8 },
  statLabel: { color: "#7A6DC4", fontSize: 12, marginTop: 2 },
  menuItem: { backgroundColor: "#1E1A4A", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#2D266B" },
  menuIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#120F2E", alignItems: "center", justifyContent: "center", marginRight: 12 },
  menuLabel: { color: "#F8F6F0", fontSize: 15, fontWeight: "600" },
  menuSub: { color: "#4a4460", fontSize: 12, marginTop: 2 },
  logoutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#E85D75", borderRadius: 14, paddingVertical: 16, marginTop: 32 },
  logoutText: { color: "#E85D75", fontWeight: "bold", fontSize: 16 },
});
