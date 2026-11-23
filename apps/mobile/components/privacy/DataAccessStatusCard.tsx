import { useState } from 'react'
import { Alert, Platform, Share, Text, TouchableOpacity, View } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { downloadDataAccessExport, refreshDataAccessExport, type DataAccessStatus } from '@/lib/data-access'
import { Colors } from '@/constants/theme'

export function DataAccessStatusCard({ request, onReload }: { request: DataAccessStatus; onReload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)

  async function refresh() {
    if (busy) return
    setBusy(true)
    try {
      await refreshDataAccessExport()
      await onReload()
      Alert.alert('Export refreshed', 'The privacy team can now review the updated package.')
    } catch (error) {
      Alert.alert('Could not refresh export', error instanceof Error ? error.message : 'Please try again.')
    } finally { setBusy(false) }
  }

  async function download() {
    if (busy) return
    setBusy(true)
    try {
      const access = Platform.OS === 'android'
        ? await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync() : null
      if (access && !access.granted) {
        Alert.alert('Choose a folder', 'Choose a folder to save your reviewed export. You can retry from this screen.')
        return
      }
      const packageData = await downloadDataAccessExport()
      const contents = JSON.stringify(packageData, null, 2)
      const name = 'drapeon-account-data.json'
      if (Platform.OS === 'android') {
        if (!access?.granted) throw new Error('A destination folder is required.')
        const uri = await FileSystem.StorageAccessFramework.createFileAsync(access.directoryUri, name, 'application/json')
        await FileSystem.writeAsStringAsync(uri, contents, { encoding: FileSystem.EncodingType.UTF8 })
      } else {
        const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory
        if (!directory) throw new Error('No file location is available on this device.')
        const uri = `${directory}${name}`
        await FileSystem.writeAsStringAsync(uri, contents, { encoding: FileSystem.EncodingType.UTF8 })
        await Share.share({ url: uri, title: 'Drapeon account data' })
      }
      await onReload()
    } catch (error) {
      Alert.alert('Could not save export', error instanceof Error ? error.message : 'Please try again.')
    } finally { setBusy(false) }
  }

  const ready = request.status === 'READY' || request.status === 'DELIVERED'
  return <View style={{ gap: 10, padding: 16, borderRadius: 12, backgroundColor: Colors.boneDeep }}>
    <Text style={{ color: Colors.ink, fontWeight: '700' }}>{ready ? 'Your reviewed export is ready' : 'Your request is in privacy review'}</Text>
    <Text style={{ color: Colors.ink }}>Request {request.id ?? 'recorded'}. {ready ? 'Save a copy of your account data.' : 'We will make the export available here after review.'}</Text>
    {request.generationWarnings ? <TouchableOpacity disabled={busy} onPress={() => void refresh()} accessibilityRole="button">
      <Text style={{ color: Colors.needleGreen, fontWeight: '700' }}>{busy ? 'Refreshing…' : 'Refresh incomplete export'}</Text>
    </TouchableOpacity> : null}
    {ready ? <TouchableOpacity disabled={busy} onPress={() => void download()} accessibilityRole="button">
      <Text style={{ color: Colors.needleGreen, fontWeight: '700' }}>{busy ? 'Preparing…' : 'Save my data export'}</Text>
    </TouchableOpacity> : null}
  </View>
}
