import { css } from "@emotion/react"

export const App = () => {
  return (
    <div className="grid place-items-center">
      <h1
        css={css`
          background-color: #f0f0f0;
      `}
      >
        Hello!
      </h1>
    </div>
  )
}
