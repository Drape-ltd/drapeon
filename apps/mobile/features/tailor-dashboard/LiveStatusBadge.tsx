import {View,Text,StyleSheet} from 'react-native'
import {Colors,Radius,FontWeight} from '@/constants/theme'
const STATUS_BADGE: Record<string, { label: string; color: string; bg: string; dot: boolean }> = {
  LIVE:          { label: 'Live',          color: Colors.success,    bg: Colors.success + '25',  dot: true },
  PENDING:       { label: 'In review',     color: Colors.warning,    bg: Colors.warning + '22',  dot: false },
  REJECTED:      { label: 'Action needed', color: Colors.error,      bg: Colors.error + '18',    dot: false },
  NOT_SUBMITTED: { label: 'Setup needed',  color: Colors.midGrey,    bg: Colors.lightGrey,       dot: false },
}

export function LiveStatusBadge({ isLive, idStatus }: { isLive: boolean; idStatus: string }) {
  const key = isLive ? 'LIVE' : (idStatus in STATUS_BADGE ? idStatus : 'NOT_SUBMITTED')
  const cfg = STATUS_BADGE[key]
  return (
    <View style={[styles.availPill, { backgroundColor: cfg.bg }]}>
      {cfg.dot && <View style={[styles.availDot, { backgroundColor: cfg.color }]} />}
      <Text style={[styles.availLabel, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  )
}

const styles=StyleSheet.create({availPill:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:Colors.white,borderRadius:Radius.full,paddingHorizontal:9,paddingVertical:4,minHeight:30,borderWidth:1,borderColor:Colors.lightGrey},availDot:{width:7,height:7,borderRadius:4},availLabel:{fontSize:11,fontWeight:FontWeight.medium,color:Colors.inkLight}})
