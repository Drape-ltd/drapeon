import * as Sentry from '@sentry/nextjs'
import { webSentryOptions } from './lib/sentry-web'

const options = webSentryOptions()
if (options.dsn) Sentry.init(options)
