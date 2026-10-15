// Is this a phone-sized screen (the phone app, or the website opened on a phone)? Read once when a screen opens.
export const isPhoneWidth = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia) && window.matchMedia('(max-width: 767px)').matches
