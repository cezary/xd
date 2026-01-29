"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { unescape as _unescape } from 'lodash-es';

type VideoItem = {
  id: string
  title: string
  src: string
  hls_url?: string
  thumbnail?: string
  reddit_url?: string
  subreddit?: string
}

type VideoFeedProps = {
  videos: VideoItem[]
}

export function VideoFeed({ videos }: VideoFeedProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const videoRefs = useRef<React.RefObject<HTMLVideoElement | null>[]>([])
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})
  const [userPaused, setUserPaused] = useState<Record<string, boolean>>({})
  const lastActiveIdRef = useRef<string | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [isMuted, setIsMuted] = useState(true)

  const ensureVideoRef = (index: number): React.RefObject<HTMLVideoElement | null> => {
    if (!videoRefs.current[index]) {
      videoRefs.current[index] = { current: null }
    }
    return videoRefs.current[index]
  }

  const handleVideoClick = useCallback((id: string, index: number) => {
    const refObj = ensureVideoRef(index)
    const el = refObj.current
    if (!el) return

    // First interaction: unmute globally, then play
    if (isMuted) {
      setIsMuted(false)
      if (el.paused && el.currentSrc) {
        el
          .play()
          .then(() => {
            setUserPaused(prev => ({ ...prev, [id]: false }))
          })
          .catch(() => {})
      }
      return
    }

    // After unmuted: toggle play/pause (only if element has a source)
    if (el.paused) {
      if (el.currentSrc) {
        el
          .play()
          .then(() => {
            setUserPaused(prev => ({ ...prev, [id]: false }))
          })
          .catch(() => {})
      }
    } else {
      el.pause()
      setUserPaused(prev => ({ ...prev, [id]: true }))
    }
  }, [isMuted])

  useEffect(() => {
    if (!sectionRefs.current.length) return

    const handleIntersection: IntersectionObserverCallback = entries => {
      let activeId: string | null = null

      entries.forEach(entry => {
        const indexAttr = (entry.target as HTMLElement).dataset.index
        if (typeof indexAttr === "undefined") return
        const index = Number(indexAttr)
        const video = videos[index]
        if (!video) return

        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          activeId = video.id
        }
      })

      if (activeId) {
        const previousActiveId = lastActiveIdRef.current
        const isNewActive = activeId !== previousActiveId
        lastActiveIdRef.current = activeId
        setActiveVideoId(activeId)

        // Load the active video and adjacent videos
        const activeIndex = videos.findIndex(v => v.id === activeId)
        const adjacentIndices = [
          activeIndex - 1, // video above
          activeIndex,     // current video
          activeIndex + 1, // video below
        ].filter(idx => idx >= 0 && idx < videos.length)

        setLoaded(prev => {
          const next = { ...prev }
          adjacentIndices.forEach(idx => {
            const vid = videos[idx]
            if (vid && !next[vid.id]) {
              next[vid.id] = true
            }
          })
          return next
        })

        // If this is a newly active video, clear any previous userPaused flag
        if (isNewActive) {
          setUserPaused(prev => {
            if (!prev[activeId!]) return prev
            const next = { ...prev }
            delete next[activeId!]
            return next
          })
        }

        // Pause and reset all non-active videos first
        videoRefs.current.forEach((r, index) => {
          const v = r?.current
          if (!v) return
          const vid = videos[index]?.id
          if (vid && vid !== activeId) {
            v.pause()
            try {
              v.currentTime = 0
            } catch {
              // ignore seek errors
            }
          }
        })

        // Then play the active one if the user has not manually paused it.
        // Only call play() if the element has a source to avoid NotSupportedError.
        const activeRef = videoRefs.current[activeIndex]
        const activeVideo = activeRef?.current
        if (activeVideo && !userPaused[activeId]) {
          activeVideo.muted = isMuted
          if (activeVideo.currentSrc) {
            activeVideo
              .play()
              .catch(() => {
                // Ignore autoplay errors
              })
          }
        }
      } else {
        // Don't set activeVideoId to null — observer can fire with no entry above
        // threshold and clear every video's src, causing "no supported sources"
        // when play() is called. Keep last active id so src stays set.
        videoRefs.current.forEach(r => {
          const v = r?.current
          if (v && !v.paused) v.pause()
        })
      }
    }

    const observer = new IntersectionObserver(handleIntersection, {
      root: null,
      threshold: [0.4, 0.6, 0.8],
    })

    sectionRefs.current.forEach(section => {
      if (section) observer.observe(section)
    })

    return () => observer.disconnect()
  }, [videos, userPaused, isMuted, activeVideoId])

  // Ensure adjacent videos stay paused when they get loaded
  useEffect(() => {
    if (activeVideoId === null) return

    const activeIndex = videos.findIndex(v => v.id === activeVideoId)
    if (activeIndex === -1) return

    const adjacentIndices = [activeIndex - 1, activeIndex + 1].filter(
      idx => idx >= 0 && idx < videos.length
    )

    adjacentIndices.forEach(idx => {
      const ref = videoRefs.current[idx]
      const video = ref?.current
      const videoItem = videos[idx]
      if (video && videoItem && loaded[videoItem.id]) {
        // Ensure adjacent videos are paused
        if (!video.paused) {
          video.pause()
        }
      }
    })
  }, [activeVideoId, videos, loaded])

  // Keyboard shortcuts
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest("input") || target.closest("textarea") || target.closest("[contenteditable]")) return

      const activeIndex = activeVideoId !== null ? videos.findIndex(v => v.id === activeVideoId) : 0
      const activeVideo = videoRefs.current[activeIndex]?.current

      switch (e.key.toLowerCase()) {
        case "j": {
          // Next video
          e.preventDefault()
          const nextSection = sectionRefs.current[activeIndex + 1]
          if (nextSection) nextSection.scrollIntoView({ behavior: "smooth", block: "start" })
          break
        }
        case "k": {
          // Previous video
          e.preventDefault()
          const prevSection = sectionRefs.current[activeIndex - 1]
          if (prevSection) prevSection.scrollIntoView({ behavior: "smooth", block: "start" })
          break
        }
        case " ": {
          // Toggle play/pause
          e.preventDefault()
          if (activeVideoId !== null && activeVideo) {
            handleVideoClick(activeVideoId, activeIndex)
          }
          break
        }
        case "f": {
          // Toggle fullscreen
          e.preventDefault()
          if (!document.fullscreenElement) {
            container.requestFullscreen?.().catch(() => {})
          } else {
            document.exitFullscreen?.()
          }
          break
        }
        case "m": {
          // Toggle mute
          e.preventDefault()
          setIsMuted(prev => !prev)
          break
        }
        case "arrowleft": {
          // Back 5 seconds
          e.preventDefault()
          if (activeVideo?.currentSrc) {
            try {
              activeVideo.currentTime = Math.max(0, activeVideo.currentTime - 5)
            } catch {}
          }
          break
        }
        case "arrowright": {
          // Forward 5 seconds
          e.preventDefault()
          if (activeVideo?.currentSrc) {
            try {
              activeVideo.currentTime = Math.min(activeVideo.duration ?? 0, activeVideo.currentTime + 5)
            } catch {}
          }
          break
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [videos, activeVideoId, handleVideoClick])

  return (
    <div className="h-screen w-screen bg-black text-white">
      <div
        ref={scrollContainerRef}
        className="h-full w-screen snap-y snap-mandatory overflow-y-scroll scrollbar-none"
      >
        {videos.map((video, index) => {
          const isActive = activeVideoId === video.id
          const activeIndex = activeVideoId !== null 
            ? videos.findIndex(v => v.id === activeVideoId)
            : -1
          const isAdjacent = activeIndex >= 0 && (
            index === activeIndex - 1 || 
            index === activeIndex + 1
          )
          // const shouldPreload = isAdjacent && !isActive
          const shouldPreload = isAdjacent || isActive
          
          // Only pass src to active video and adjacent videos (for preloading)
          const videoSrc = (isActive || isAdjacent) && loaded[video.id]
            ? video.hls_url?.replace(/&amp;/g, '&').replace(/f=sd/, 'f=hq')
            : undefined

          return (
            <section
              key={video.id}
              ref={el => {
                sectionRefs.current[index] = el
              }}
              data-index={index}
              className="max-h-svh snap-start snap-always h-screen flex flex-col items-center justify-center sm:px-4"
            >
              <div className="relative w-fit h-full max-h-[95dvh] max-w-3xl rounded-xl overflow-hidden bg-black shadow-xl flex items-center justify-center">
                <video
                  ref={ensureVideoRef(index)}
                  className="h-full w-auto object-contain bg-black"
                  src={videoSrc}
                  poster={video.thumbnail ? _unescape(video.thumbnail) : undefined}
                  playsInline
                  muted={isMuted}
                  preload={shouldPreload ? "auto" : "none"}
                  // loop
                  // controls
                  onClick={(e) => { e.preventDefault(); handleVideoClick(video.id, index) }}
                  onEnded={() => {
                    // Restart when loop fails (e.g. HLS); only if still active and has source
                    if (activeVideoId !== video.id) return
                    const ref = videoRefs.current[index]?.current
                    if (ref?.currentSrc && ref.paused) {
                      ref.currentTime = 0;
                      ref.load();
                      ref.play().catch((err) => { console.log('error restarting video', err); })
                    }
                  }}
                />
                <div className="absolute bottom-0 left-0 right-0 w-full p-4 text-base font-medium text-shadow-lg/30 flex flex-col gap-0.5">
                  {video.subreddit && (
                    <a
                      href={`https://reddit.com/r/${video.subreddit}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:text-white/80 transition-colors"
                    >
                      r/{video.subreddit}
                    </a>
                  )}
                  {video.reddit_url ? (
                    <a
                      href={video.reddit_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:text-white/80 transition-colors line-clamp-1 hover:line-clamp-none"
                    >
                      {video.title}
                    </a>
                  ) : (
                    video.title
                  )}
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

