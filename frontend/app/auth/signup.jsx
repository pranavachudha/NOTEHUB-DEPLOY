import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator, StyleSheet } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "../../context/AuthContext";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SignupScreen() {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    if (!name.trim() || !email.trim() || !password.trim()) { Alert.alert("Missing fields", "Please fill in all fields."); return; }
    if (password !== confirm) { Alert.alert("Mismatch", "Passwords do not match."); return; }
    if (password.length < 6) { Alert.alert("Weak password", "At least 6 characters required."); return; }
    setLoading(true);
    try { await signup(name.trim(), email.trim().toLowerCase(), password); }
    catch (err) { Alert.alert("Signup failed", err.response?.data?.detail || "Something went wrong."); }
    finally { setLoading(false); }
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <TouchableOpacity onPress={() => router.replace("/auth/login")} style={{ marginBottom: 24 }}>
            <Text style={{ color: "#F5A623", fontSize: 15 }}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>Create account</Text>
          <Text style={s.subtitle}>Start capturing your notes today</Text>
          <View style={s.divider} />
          <Text style={s.label}>Full Name</Text>
          <TextInput style={s.input} placeholder="Ada Lovelace" placeholderTextColor="#4a4460" value={name} onChangeText={setName} />
          <Text style={[s.label, { marginTop: 16 }]}>Email</Text>
          <TextInput style={s.input} placeholder="ada@university.edu" placeholderTextColor="#4a4460" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Text style={[s.label, { marginTop: 16 }]}>Password</Text>
          <TextInput style={s.input} placeholder="At least 6 characters" placeholderTextColor="#4a4460" value={password} onChangeText={setPassword} secureTextEntry />
          <Text style={[s.label, { marginTop: 16 }]}>Confirm Password</Text>
          <TextInput style={s.input} placeholder="••••••••" placeholderTextColor="#4a4460" value={confirm} onChangeText={setConfirm} secureTextEntry />
          <TouchableOpacity style={s.button} onPress={handleSignup} disabled={loading}>
            {loading ? <ActivityIndicator color="#0A0A0F" /> : <Text style={s.buttonText}>Create Account</Text>}
          </TouchableOpacity>
          <View style={s.footer}>
            <Text style={s.footerText}>Already have an account?  </Text>
            <TouchableOpacity onPress={() => router.replace("/auth/login")}>
              <Text style={s.footerLink}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 24, paddingBottom: 40 },
  title: { fontSize: 36, fontWeight: "bold", color: "#F8F6F0" },
  subtitle: { fontSize: 14, color: "#7A6DC4", marginTop: 6 },
  divider: { height: 1, backgroundColor: "#1E1A4A", marginVertical: 28 },
  label: { fontSize: 12, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 },
  input: { backgroundColor: "#1E1A4A", color: "#F8F6F0", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, borderWidth: 1, borderColor: "#2D266B" },
  button: { backgroundColor: "#F5A623", borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 28 },
  buttonText: { color: "#0A0A0F", fontWeight: "bold", fontSize: 16 },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 32 },
  footerText: { color: "#4a4460", fontSize: 14 },
  footerLink: { color: "#F5A623", fontSize: 14, fontWeight: "600" },
});
