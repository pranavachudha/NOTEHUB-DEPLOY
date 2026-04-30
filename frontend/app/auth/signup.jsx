import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert, ActivityIndicator, StyleSheet } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "../../context/AuthContext";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SignupScreen() {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignup() {
    setError("");
    if (!name.trim() || !username.trim() || !email.trim() || !password.trim()) { setError("Please fill in all fields."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{6,}$/;
    if (!passwordRegex.test(password)) {
      setError("Password must be at least 6 characters and include a capital letter, a number, and a symbol.");
      return;
    }

    setLoading(true);
    try { 
      const res = await signup(name.trim(), username.trim().toLowerCase(), email.trim().toLowerCase(), password); 
      if (res.is_verified) {
        Alert.alert("Success", "Account created and verified! Please log in.");
        router.replace("/auth/login");
      } else {
        router.push({ pathname: "/auth/verify", params: { email: email.trim().toLowerCase(), otp_debug: res.otp_debug } });
      }
    }
    catch (err) { setError(err.response?.data?.detail || "Signup failed. Please try again."); }
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
          
          {error ? (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#E85D75" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={s.divider} />
          <Text style={s.label}>Full Name</Text>
          <TextInput style={s.input} placeholder="Ada Lovelace" placeholderTextColor="#4a4460" value={name} onChangeText={setName} />
          
          <Text style={[s.label, { marginTop: 16 }]}>Username</Text>
          <TextInput style={s.input} placeholder="ada.dev" placeholderTextColor="#4a4460" value={username} onChangeText={setUsername} autoCapitalize="none" />
          
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
  errorBox: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(232, 93, 117, 0.1)", padding: 12, borderRadius: 10, marginTop: 20, gap: 8, borderWidth: 1, borderColor: "rgba(232, 93, 117, 0.2)" },
  errorText: { color: "#E85D75", fontSize: 13, flex: 1, fontWeight: "500" },
});
