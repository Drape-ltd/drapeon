import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { orderMediaStoragePath, styleAlignmentPhotoStoragePath } from './order-media.ts'

Deno.test('normalises private order-media paths and legacy delivery URLs', () => {
  assertEquals(orderMediaStoragePath('brief/customer/photo.jpg'), 'brief/customer/photo.jpg')
  assertEquals(
    orderMediaStoragePath('https://project.supabase.co/storage/v1/object/public/order-photos/brief/customer/photo.jpg'),
    'brief/customer/photo.jpg',
  )
  assertEquals(
    orderMediaStoragePath('https://project.supabase.co/storage/v1/object/sign/order-photos/progress/order/photo.jpg?token=value'),
    'progress/order/photo.jpg',
  )
})

Deno.test('rejects external, malformed and non-order-media values', () => {
  assertEquals(orderMediaStoragePath('https://example.com/photo.jpg'), null)
  assertEquals(orderMediaStoragePath('https://project.supabase.co/storage/v1/object/public/avatars/customer/photo.jpg'), null)
  assertEquals(orderMediaStoragePath('../brief/customer/photo.jpg'), null)
  assertEquals(orderMediaStoragePath(''), null)
})

Deno.test('style alignment accepts private paths and legacy delivery URLs for only its order', () => {
  const orderId = '05b99270-7394-46f2-9ac9-d870701e9c74'
  const path = `progress/${orderId}/style-alignment-image.jpg`
  assertEquals(styleAlignmentPhotoStoragePath(path, orderId), path)
  assertEquals(styleAlignmentPhotoStoragePath(`https://project.supabase.co/storage/v1/object/public/order-photos/${path}`, orderId), path)
  assertEquals(styleAlignmentPhotoStoragePath(`https://project.supabase.co/storage/v1/object/sign/order-photos/${path}?token=example`, orderId), path)
  assertEquals(styleAlignmentPhotoStoragePath(`progress/other-order/style-alignment-image.jpg`, orderId), null)
  assertEquals(styleAlignmentPhotoStoragePath(`progress/${orderId}/unrelated-image.jpg`, orderId), null)
})
