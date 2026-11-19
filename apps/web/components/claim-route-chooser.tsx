'use client'

import { useState } from 'react'
import { ClaimAppHandoff } from './claim-app-handoff'
import { ClaimWebFlow } from './claim-web-flow'

export function ClaimRouteChooser({ token }: { token: string }) {
  const [mobileWeb, setMobileWeb] = useState(false)
  const [desktopApp, setDesktopApp] = useState(false)

  return (
    <div className="mx-auto max-w-2xl">
      <div className={`${mobileWeb ? 'max-sm:hidden' : ''} ${desktopApp ? '' : 'sm:hidden'}`}>
        <ClaimAppHandoff token={token} />
      </div>
      <div className={`${mobileWeb ? '' : 'max-sm:hidden'} ${desktopApp ? 'sm:hidden' : ''}`}>
        <ClaimWebFlow token={token} />
      </div>
      <div className="mt-4 text-center sm:hidden">
        <button
          className="text-sm font-semibold text-needle underline underline-offset-4"
          type="button"
          onClick={() => setMobileWeb((current) => !current)}
        >
          {mobileWeb ? 'Use the app instead' : 'Continue in this browser instead'}
        </button>
      </div>
      <div className="mt-4 hidden text-center sm:block">
        <button
          className="text-sm font-semibold text-needle underline underline-offset-4"
          type="button"
          onClick={() => setDesktopApp((current) => !current)}
        >
          {desktopApp ? 'Continue in this browser instead' : 'Use the app instead'}
        </button>
      </div>
    </div>
  )
}
