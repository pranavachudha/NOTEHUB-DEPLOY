import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useState, useRef } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import api from "../../services/api";

const MODES = { IDLE: "idle", CAMERA: "camera", REVIEW: "review", UPLOADING: "uploading" };

export default function CaptureScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState(MODES.IDLE);
  const [photos, setPhotos] = useState([]);
  const [title, setTitle] = useState("");
  const cameraRef = useRef(null);

  async function openCamera() {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setMode(MODES.CAMERA);
  }

  async function takePicture() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.8 });
    setPhotos(prev => [...prev, { uri: photo.uri, base64: photo.base64 }]);
  }

  async function uploadAndCreate() {
    if (!title.trim()) { Alert.alert("Title required", "Give your notes a title."); return; }
    if (photos.length === 0) { Alert.alert("No photos", "Take at least one photo."); return; }
    setMode(MODES.UPLOADING);
    try {
      const formData = new FormData();
      formData.append("title", title.trim());
      photos.forEach((p, i) => {
        // Use unique keys per image — React Native FormData drops duplicate keys
        formData.append(`image_${i}`, { uri: p.uri, name: `photo_${i}.jpg`, type: "image/jpeg" });
      });
      formData.append("image_count", photos.length.toString());
      await api.post("/documents/create", formData, { headers: { "Content-Type": "multipart/form-data" } });
      setPhotos([]);
      setTitle("");
      setMode(MODES.IDLE);
      Alert.alert("✓ Saved!", "Your notes have been extracted and saved as a PDF.");
    } catch {
      Alert.alert("Upload failed", "Could not save. Check your connection.");
      setMode(MODES.REVIEW);
    }
  }

  // Camera mode
  if (mode === MODES.CAMERA) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
        <View style={cam.topBar}>
          <TouchableOpacity onPress={() => setMode(MODES.IDLE)} style={cam.iconBtn}>
            <Ionicons name="close" size={28} color="white" />
          </TouchableOpacity>
          <View style={cam.badge}>
            <Text style={cam.badgeText}>{photos.length} photo{photos.length !== 1 ? "s" : ""}</Text>
          </View>
          {photos.length > 0
            ? <TouchableOpacity onPress={() => setMode(MODES.REVIEW)} style={cam.doneBtn}>
                <Text style={{ color: "#0A0A0F", fontWeight: "bold" }}>Review</Text>
              </TouchableOpacity>
            : <View style={{ width: 70 }} />}
        </View>
        <View style={cam.bottomBar}>
          <TouchableOpacity onPress={takePicture}>
            <View style={cam.shutter} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Review mode
  if (mode === MODES.REVIEW) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.navBar}>
          <TouchableOpacity onPress={() => setMode(MODES.CAMERA)}>
            <Ionicons name="arrow-back" size={24} color="#F5A623" />
          </TouchableOpacity>
          <Text style={s.navTitle}>Review ({photos.length})</Text>
          <TouchableOpacity onPress={() => setMode(MODES.CAMERA)}>
            <Text style={{ color: "#F5A623" }}>+ Add</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text style={s.label}>Document Title</Text>
          <TextInput style={s.input} placeholder="e.g. Chemistry Lecture 5" placeholderTextColor="#4a4460" value={title} onChangeText={setTitle} />
          <Text style={[s.label, { marginTop: 20 }]}>Photos</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {photos.map((p, i) => (
              <View key={i} style={{ width: "30%" }}>
                <Image source={{ uri: p.uri }} style={{ width: "100%", aspectRatio: 3/4, borderRadius: 10 }} />
                <TouchableOpacity onPress={() => setPhotos(prev => prev.filter((_, j) => j !== i))} style={s.removeBtn}>
                  <Ionicons name="close" size={12} color="white" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </ScrollView>
        <View style={s.bottomAction}>
          <TouchableOpacity style={s.btn} onPress={uploadAndCreate}>
            <Text style={s.btnText}>Extract Text & Save PDF</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Uploading mode
  if (mode === MODES.UPLOADING) {
    return (
      <SafeAreaView style={[s.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color="#F5A623" size="large" />
        <Text style={[s.title, { marginTop: 20 }]}>Extracting text…</Text>
        <Text style={{ color: "#7A6DC4", marginTop: 8 }}>Generating your PDF</Text>
      </SafeAreaView>
    );
  }

  // Idle mode
  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <Text style={s.screenLabel}>NoteHub</Text>
        <Text style={s.title}>Capture Notes</Text>
        <TouchableOpacity style={s.cameraBtn} onPress={openCamera}>
          <Ionicons name="camera" size={56} color="#F5A623" />
        </TouchableOpacity>
        <Text style={[s.title, { fontSize: 22, marginTop: 24, textAlign: "center" }]}>Start Capturing</Text>
        <Text style={[s.subtitle, { textAlign: "center" }]}>Take photos of your notes, slides, or textbooks.</Text>
        <View style={{ marginTop: 28, gap: 12 }}>
          {[
            { step: "1", icon: "camera-outline", label: "Take photos inside the app" },
            { step: "2", icon: "text-outline", label: "OCR extracts all text automatically" },
            { step: "3", icon: "document-text-outline", label: "Saved as a searchable PDF" },
          ].map(item => (
            <View key={item.step} style={s.stepCard}>
              <View style={s.stepNum}><Text style={{ color: "#0A0A0F", fontWeight: "bold" }}>{item.step}</Text></View>
              <Ionicons name={item.icon} size={20} color="#7A6DC4" style={{ marginRight: 10 }} />
              <Text style={{ color: "#D8D4F0", fontSize: 14, flex: 1 }}>{item.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  screenLabel: { fontSize: 12, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 },
  title: { fontSize: 30, fontWeight: "bold", color: "#F8F6F0" },
  subtitle: { fontSize: 15, color: "#7A6DC4", lineHeight: 24, marginTop: 8 },
  label: { fontSize: 12, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 },
  input: { backgroundColor: "#1E1A4A", color: "#F8F6F0", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16, fontSize: 16, borderWidth: 1, borderColor: "#2D266B" },
  btn: { backgroundColor: "#F5A623", borderRadius: 12, paddingVertical: 16, alignItems: "center" },
  btnText: { color: "#0A0A0F", fontWeight: "bold", fontSize: 16 },
  bottomAction: { padding: 20, borderTopWidth: 1, borderTopColor: "#1E1A4A" },
  navBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#1E1A4A" },
  navTitle: { color: "#F8F6F0", fontWeight: "bold", fontSize: 18 },
  removeBtn: { position: "absolute", top: -8, right: -8, backgroundColor: "#E85D75", borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  cameraBtn: { width: 140, height: 140, borderRadius: 70, backgroundColor: "#1E1A4A", borderWidth: 3, borderColor: "#F5A623", alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 32 },
  stepCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#1E1A4A", borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14 },
  stepNum: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#F5A623", alignItems: "center", justifyContent: "center", marginRight: 12 },
});

const cam = StyleSheet.create({
  topBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 52, paddingBottom: 16, backgroundColor: "rgba(0,0,0,0.5)" },
  iconBtn: { padding: 8 },
  badge: { backgroundColor: "rgba(245,166,35,0.9)", paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20 },
  badgeText: { color: "#0A0A0F", fontWeight: "bold", fontSize: 13 },
  doneBtn: { backgroundColor: "#F5A623", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", paddingBottom: 48, paddingTop: 20, backgroundColor: "rgba(0,0,0,0.6)" },
  shutter: { width: 76, height: 76, borderRadius: 38, backgroundColor: "white", borderWidth: 5, borderColor: "#F5A623" },
});
