"use client"

import React, { useEffect, useRef, useState } from "react"
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

  const handleVideoClick = (id: string, index: number) => {
    const refObj = ensureVideoRef(index)
    const el = refObj.current
    if (!el) return

    // First interaction: unmute globally, then play
    if (isMuted) {
      setIsMuted(false)
      // Immediately unmute all existing videos
      // videoRefs.current.forEach(r => {
      //   if (r?.current) {
      //     r.current.muted = false
      //   }
      // })

      if (el.paused) {
        el
          .play()
          .then(() => {
            setUserPaused(prev => ({ ...prev, [id]: false }))
          })
          .catch(() => {
            // Ignore play errors
          })
      }
      return
    }

    // After unmuted: toggle play/pause
    if (el.paused) {
      el
        .play()
        .then(() => {
          setUserPaused(prev => ({ ...prev, [id]: false }))
        })
        .catch(() => {
          // Ignore play errors
        })
    } else {
      el.pause()
      setUserPaused(prev => ({ ...prev, [id]: true }))
    }
  }

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

        // Then play the active one if the user has not manually paused it
        const activeRef = videoRefs.current[activeIndex]
        const activeVideo = activeRef?.current
        if (activeVideo && !userPaused[activeId]) {
          activeVideo.muted = isMuted
          activeVideo
            .play()
            .catch(() => {
              // Ignore autoplay errors
            })
        }
      } else {
        // If nothing is strongly in view, pause all (and leave time as-is)
        setActiveVideoId(null)
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

  return (
    <div className="h-screen w-screen bg-black text-white">
      <div className="h-full w-screen snap-y snap-mandatory overflow-y-scroll">
        {videos.map((video, index) => {
          const isActive = activeVideoId === video.id
          const activeIndex = activeVideoId !== null 
            ? videos.findIndex(v => v.id === activeVideoId)
            : -1
          const isAdjacent = activeIndex >= 0 && (
            index === activeIndex - 1 || 
            index === activeIndex + 1
          )
          const shouldPreload = isAdjacent && !isActive
          
          // Only pass src to active video and adjacent videos (for preloading)
          const videoSrc = (isActive || isAdjacent) && loaded[video.id]
            ? video.hls_url?.replace(/&amp;/g, '&').replace(/f=sd/, 'f=hq') ?? video.src
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
                  loop={true}
                  onClick={() => handleVideoClick(video.id, index)}
                />
                <div className="absolute bottom-0 left-0 right-0 w-full p-4 text-base font-medium text-shadow-md flex flex-col gap-0.5">
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

