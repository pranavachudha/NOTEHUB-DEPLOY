import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, Modal, ScrollView, RefreshControl, StyleSheet, TextInput
} from "react-native";
import { useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useAppAlert } from "../../components/AppAlert";
import api from "../../services/api";

export default function DocsScreen() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [joinedChannels, setJoinedChannels] = useState([]);
  const [showChannelSelect, setShowChannelSelect] = useState(false);

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const { show, element } = useAppAlert();

  function wordCount(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).length;
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString();
    } catch { return iso; }
  }

  async function saveDocEdit() {
    setSavingEdit(true);
    try {
      await api.put(`/documents/${selectedDoc.id}`, { title: editTitle.trim(), extracted_text: editContent });
      setSelectedDoc(prev => ({ ...prev, title: editTitle.trim(), extracted_text: editContent }));
      setIsEditing(false);
      loadDocs(true);
      show("Saved", "Your document was updated.");
    } catch (err) { 
      console.error("Save error:", err);
      show("Error", "Could not save document. Check your connection."); 
    }
    finally { setSavingEdit(false); }
  }

  useFocusEffect(useCallback(() => { loadDocs(); }, []));

  async function loadDocs(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await api.get("/documents");
      setDocs(res.data);
    } catch { if (!silent) show("Error", "Could not load documents."); }
    finally { setLoading(false); setRefreshing(false); }
  }

  async function deleteDoc(doc) {
    show("Delete document", `Delete "${doc.title}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel", onPress: () => {} },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await api.delete(`/documents/${doc.id}`);
          setDocs(prev => prev.filter(d => d.id !== doc.id));
          if (selectedDoc?.id === doc.id) setSelectedDoc(null);
        } catch { show("Error", "Could not delete document."); }
      }},
    ]);
  }

  async function downloadPDF(doc) {
    setDownloading(true);
    try {
      const res = await api.get(`/documents/${doc.id}`);
      const path = FileSystem.documentDirectory + `${doc.title.replace(/\s+/g, "_")}.pdf`;
      await FileSystem.writeAsStringAsync(path, res.data.pdf_base64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(path, { mimeType: "application/pdf" });
    } catch { show("Error", "Could not download PDF."); }
    finally { setDownloading(false); }
  }

  async function fetchJoinedChannels() {
    try {
      const res = await api.get("/channels");
      setJoinedChannels(res.data.filter(c => c.is_member));
      setShowChannelSelect(true);
    } catch { show("Error", "Could not load channels."); }
  }

  async function submitToChannel(channelId) {
    setSubmitting(true);
    try {
      await api.post(`/channels/${channelId}/submit`, { document_id: selectedDoc.id });
      show("Submitted", "Note submitted to channel for admin approval.");
      setShowChannelSelect(false);
    } catch { show("Error", "Could not submit note."); }
    finally { setSubmitting(false); }
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function wordCount(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  if (loading) {
    return (
      <SafeAreaView style={[s.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color="#F5A623" size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container}>
      {element}
      <View style={s.header}>
        <View>
          <Text style={s.screenLabel}>NoteHub</Text>
          <Text style={s.title}>Saved Docs</Text>
        </View>
        <View style={s.countBadge}>
          <Text style={s.countText}>{docs.length}</Text>
        </View>
      </View>

      {docs.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="document-text-outline" size={64} color="#2D266B" />
          <Text style={s.emptyTitle}>No documents yet</Text>
          <Text style={s.emptySubtitle}>Capture your first notes to get started</Text>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadDocs(true); }} tintColor="#F5A623" />}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => setSelectedDoc(item)} style={s.card}>
              <View style={s.cardHeader}>
                <View style={s.cardIcon}>
                  <Ionicons name="document-text" size={20} color="#F5A623" />
                </View>
                <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                <TouchableOpacity onPress={() => deleteDoc(item)} style={s.deleteBtn}>
                  <Ionicons name="trash-outline" size={18} color="#E85D75" />
                </TouchableOpacity>
              </View>
              <View style={s.chips}>
                <Chip icon="images-outline" label={`${item.image_count} photo${item.image_count !== 1 ? "s" : ""}`} />
                <Chip icon="text-outline" label={`${wordCount(item.extracted_text)} words`} />
                <Chip icon="calendar-outline" label={formatDate(item.created_at)} />
              </View>
              {item.extracted_text ? <Text style={s.preview} numberOfLines={2}>{item.extracted_text}</Text> : null}
              <View style={s.cardFooter}>
                <Text style={s.viewText}>Tap to view text</Text>
                <TouchableOpacity onPress={() => downloadPDF(item)} disabled={downloading} style={s.exportBtn}>
                  <Ionicons name="download-outline" size={15} color="#7A6DC4" />
                  <Text style={s.exportText}>Export PDF</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={!!selectedDoc} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setSelectedDoc(null); setIsEditing(false); }}>
        {selectedDoc && (
          <SafeAreaView style={s.container}>
            {element}
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => { setSelectedDoc(null); setIsEditing(false); }} style={{ marginRight: 12 }}>
                <Ionicons name="close" size={22} color="#F5A623" />
              </TouchableOpacity>
              
              {isEditing ? (
                <TextInput 
                  style={[s.modalTitle, s.editTitleInput]} 
                  value={editTitle} 
                  onChangeText={setEditTitle} 
                />
              ) : (
                <Text style={s.modalTitle} numberOfLines={1}>{selectedDoc.title}</Text>
              )}

              {isEditing ? (
                <TouchableOpacity onPress={saveDocEdit} disabled={savingEdit} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {savingEdit ? <ActivityIndicator size="small" color="#F5A623" /> : (
                    <>
                      <Text style={{ color: "#F5A623", fontWeight: "bold" }}>Save</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity onPress={() => { setEditTitle(selectedDoc.title); setEditContent(selectedDoc.extracted_text || ""); setIsEditing(true); }} style={{ marginRight: 16 }}>
                    <Ionicons name="pencil" size={22} color="#F5A623" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={fetchJoinedChannels} disabled={downloading || submitting} style={{ marginRight: 16 }}>
                    <Ionicons name="cloud-upload-outline" size={22} color="#F5A623" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => downloadPDF(selectedDoc)} disabled={downloading}>
                    {downloading ? <ActivityIndicator color="#F5A623" size="small" /> : <Ionicons name="share-outline" size={22} color="#F5A623" />}
                  </TouchableOpacity>
                </>
              )}
            </View>
            
            <View style={s.modalMeta}>
              <Chip icon="images-outline" label={`${selectedDoc.image_count} photo${selectedDoc.image_count !== 1 ? "s" : ""}`} />
              <Chip icon="calendar-outline" label={formatDate(selectedDoc.created_at)} />
              <Chip icon="text-outline" label={`${wordCount(selectedDoc.extracted_text)} words`} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={s.screenLabel}>Extracted Text</Text>
              <View style={s.textBox}>
                {isEditing ? (
                  <TextInput 
                    style={[s.extractedText, { padding: 0 }]} 
                    multiline 
                    value={editContent} 
                    onChangeText={setEditContent} 
                  />
                ) : (
                  <Text style={s.extractedText}>{selectedDoc.extracted_text || "No text was extracted."}</Text>
                )}
              </View>
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>

      <Modal visible={showChannelSelect} animationType="fade" transparent>
        <View style={s.modalOverlay}>
          <View style={s.createModal}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 16, alignItems: "center" }}>
              <Text style={s.createModalTitle}>Submit to Channel</Text>
              <TouchableOpacity onPress={() => setShowChannelSelect(false)}><Ionicons name="close" size={24} color="#F5A623" /></TouchableOpacity>
            </View>
            {joinedChannels.length === 0 ? (
              <Text style={{ color: "#7A6DC4", marginBottom: 20 }}>You haven't joined any channels yet.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 300 }}>
                {joinedChannels.map(c => (
                  <TouchableOpacity key={c.id} style={s.channelRow} onPress={() => submitToChannel(c.id)} disabled={submitting}>
                    <Ionicons name="library" size={20} color="#7A6DC4" />
                    <Text style={s.channelName}>{c.name}</Text>
                    {submitting ? <ActivityIndicator size="small" color="#F5A623" /> : <Ionicons name="chevron-forward" size={20} color="#3D348B" />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Chip({ icon, label }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#120F2E", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Ionicons name={icon} size={11} color="#7A6DC4" />
      <Text style={{ color: "#7A6DC4", fontSize: 11 }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A0A0F" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  screenLabel: { fontSize: 11, color: "#7A6DC4", textTransform: "uppercase", letterSpacing: 2, marginBottom: 2 },
  title: { fontSize: 28, fontWeight: "bold", color: "#F8F6F0" },
  countBadge: { backgroundColor: "#1E1A4A", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: "#2D266B" },
  countText: { color: "#F5A623", fontWeight: "bold", fontSize: 18 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyTitle: { fontSize: 22, fontWeight: "bold", color: "#F8F6F0", marginTop: 16, textAlign: "center" },
  emptySubtitle: { fontSize: 14, color: "#7A6DC4", marginTop: 8, textAlign: "center" },
  card: { backgroundColor: "#1E1A4A", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#2D266B" },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  cardIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#120F2E", alignItems: "center", justifyContent: "center", marginRight: 10 },
  cardTitle: { color: "#F8F6F0", fontWeight: "bold", fontSize: 15, flex: 1, lineHeight: 21 },
  deleteBtn: { padding: 4, marginLeft: 8 },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  preview: { color: "#7A6DC4", fontSize: 13, marginTop: 10, lineHeight: 20 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#2D266B" },
  viewText: { color: "#F5A623", fontSize: 13, fontWeight: "600" },
  exportBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  exportText: { color: "#7A6DC4", fontSize: 13 },
  modalHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#1E1A4A" },
  modalTitle: { color: "#F8F6F0", fontWeight: "bold", fontSize: 16, flex: 1, marginRight: 12 },
  editTitleInput: { backgroundColor: "#1E1A4A", borderWidth: 1, borderColor: "#2D266B", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  modalMeta: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#1E1A4A", flexWrap: "wrap" },
  textBox: { backgroundColor: "#1E1A4A", borderRadius: 12, padding: 16, marginTop: 12, borderWidth: 1, borderColor: "#2D266B" },
  extractedText: { color: "#F8F6F0", fontSize: 15, lineHeight: 26 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end", padding: 20 },
  createModal: { backgroundColor: "#1E1A4A", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#2D266B", paddingBottom: 40 },
  createModalTitle: { color: "#F8F6F0", fontSize: 20, fontWeight: "bold" },
  channelRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#0A0A0F", padding: 16, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: "#2D266B" },
  channelName: { color: "#F8F6F0", fontSize: 16, fontWeight: "600", flex: 1, marginLeft: 12 },
});
