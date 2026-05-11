import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator, StyleSheet } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "../../context/AuthContext";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    setError("");
    if (!email.trim() || !password.trim()) { setError("Please fill in all fields."); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    try { await login(email.trim().toLowerCase(), password); }
    catch (err) { setError(err.response?.data?.detail || "Login failed. Check your credentials."); }
    finally { setLoading(false); }
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={s.logo}>NoteHub</Text>
          <Text style={s.tagline}>Capture knowledge, anywhere.</Text>

          {error ? (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#E85D75" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={s.divider} />
          <Text style={s.label}>Email</Text>
          <TextInput style={s.input} placeholder="student@university.edu" placeholderTextColor="#4a4460" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Text style={[s.label, { marginTop: 20 }]}>Password</Text>
          <TextInput style={s.input} placeholder="••••••••" placeholderTextColor="#4a4460" value={password} onChangeText={setPassword} secureTextEntry />
          <TouchableOpacity style={s.button} onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color="#0A0A0F" /> : <Text style={s.buttonText}>Sign In</Text>}
          </TouchableOpacity>
          <View style={s.footer}>
            <Text style={s.footerText}>New to NoteHub?  </Text>
            <TouchableOpacity onPress={() => router.push("/auth/signup")}>
              <Text style={s.footerLink}>Create account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 48, paddingBottom: 40 },
  logo: { fontSize: 44, fontWeight: "bold", color: "#F5A623" },
  tagline: { fontSize: 15, color: "#7A6DC4", marginTop: 6 },
  divider: { height: 1, backgroundColor: "#1E1A4A", marginVertical: 32 },
  label: { fontSize: 12, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 },
  input: { backgroundColor: "#1E1A4A", color: "#F8F6F0", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, borderWidth: 1, borderColor: "#2D266B" },
  button: { backgroundColor: "#F5A623", borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 28 },
  buttonText: { color: "#0A0A0F", fontWeight: "bold", fontSize: 16 },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 40 },
  footerText: { color: "#4a4460", fontSize: 14 },
  footerLink: { color: "#F5A623", fontSize: 14, fontWeight: "600" },
  errorBox: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(232, 93, 117, 0.1)", padding: 12, borderRadius: 10, marginTop: 20, gap: 8, borderWidth: 1, borderColor: "rgba(232, 93, 117, 0.2)" },
  errorText: { color: "#E85D75", fontSize: 13, flex: 1, fontWeight: "500" },
});
