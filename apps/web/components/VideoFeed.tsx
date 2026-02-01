"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { unescape } from 'lodash-es'

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

const SECONDS_PER_JUMP = 5;

export function VideoFeed({ videos }: VideoFeedProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const videoRefs = useRef<React.RefObject<HTMLVideoElement | null>[]>([])
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})
  const [userPaused, setUserPaused] = useState<Record<string, boolean>>({})
  const lastActiveIdRef = useRef<string | null>(null)
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const hasInteractedRef = useRef(false)
  const [videoProgress, setVideoProgress] = useState<Record<string, { currentTime: number; duration: number }>>({})
  
  // Touch scrubbing state
  const touchStartRef = useRef<{ x: number; y: number; time: number; videoIndex: number } | null>(null)
  const isScrrubbingRef = useRef(false)
  const [isScrubbing, setIsScrubbing] = useState(false)

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

    // First ever interaction: unmute globally, then play
    if (!hasInteractedRef.current) {
      hasInteractedRef.current = true
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

    // After first interaction: toggle play/pause only (don't affect mute state)
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
  }, [])

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

        if (entry.isIntersecting && entry.intersectionRatio >= 0.95) {
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
      threshold: [0.9, 0.95, 1.0],
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
        case "r": {
          e.preventDefault();
          if (activeVideoId === null) return;
          const activeIndex = videos.findIndex(v => v.id === activeVideoId)
          if (activeIndex === -1) return;
          const activeVideo = videoRefs.current[activeIndex]?.current
          if (activeVideo?.currentSrc && activeVideo.duration) {
            activeVideo.currentTime = 0;
          }
          break;
        }
        case "arrowleft": {
          // Back 5 seconds with wraparound
          e.preventDefault()
          if (activeVideo?.currentSrc && activeVideo.duration) {
            try {
              const newTime = activeVideo.currentTime - SECONDS_PER_JUMP
              activeVideo.currentTime = newTime < 0
                ? activeVideo.duration + newTime
                : newTime
            } catch {}
          }
          break
        }
        case "arrowright": {
          // Forward 5 seconds with wraparound
          e.preventDefault()
          if (activeVideo?.currentSrc && activeVideo.duration) {
            try {
              const newTime = activeVideo.currentTime + SECONDS_PER_JUMP
              activeVideo.currentTime = newTime > activeVideo.duration
                ? newTime - activeVideo.duration
                : newTime
            } catch {}
          }
          break
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [videos, activeVideoId, handleVideoClick])

  // Update page title based on active video
  useEffect(() => {
    if (activeVideoId) {
      const activeVideo = videos.find(v => v.id === activeVideoId)
      if (activeVideo) {
        const title = activeVideo.title || ''
        const subreddit = activeVideo.subreddit ? `r/${activeVideo.subreddit}` : ''
        const parts = [subreddit, title].filter(Boolean).join(' ')
        document.title = parts ? `${parts} - xd` : 'xd'
      } else {
        document.title = 'xd'
      }
    } else {
      document.title = 'xd'
    }

    return () => {
      document.title = 'xd'
    }
  }, [activeVideoId, videos])

  return (
    <div className="h-screen w-screen bg-black text-white">
      <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
        <div className="text-2xl text-shadow-lg/30 mix-blend-difference font-sans font-bold">xD</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (activeVideoId === null) return
              const activeIndex = videos.findIndex(v => v.id === activeVideoId)
              if (activeIndex === -1) return
              handleVideoClick(activeVideoId, activeIndex)
            }}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors backdrop-blur-sm"
            aria-label={activeVideoId && userPaused[activeVideoId] ? "Play" : "Pause"}
          >
            {activeVideoId && userPaused[activeVideoId] ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
              >
                <path fill="currentColor" d="M8 17.175V6.825q0-.425.3-.713t.7-.287q.125 0 .263.037t.262.113l8.15 5.175q.225.15.338.375t.112.475t-.112.475t-.338.375l-8.15 5.175q-.125.075-.262.113T9 18.175q-.4 0-.7-.288t-.3-.712" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path fill="currentColor" d="M16 19q-.825 0-1.412-.587T14 17V7q0-.825.588-1.412T16 5t1.413.588T18 7v10q0 .825-.587 1.413T16 19m-8 0q-.825 0-1.412-.587T6 17V7q0-.825.588-1.412T8 5t1.413.588T10 7v10q0 .825-.587 1.413T8 19" />
              </svg>
            )}
          </button>
          <button
            onClick={() => setIsMuted(prev => !prev)}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors backdrop-blur-sm"
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              </svg>
            )}
          </button>
        </div>
      </div>
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
              <div className="relative w-fit h-full max-h-[98dvh] max-w-3xl rounded-xl overflow-hidden bg-black shadow-xl flex items-center justify-center">
                <video
                  ref={ensureVideoRef(index)}
                  className="h-full w-auto object-contain bg-black"
                  // HACK time fragment forces Safari to load the first tiny fraction of the video, enabling the thumbnail
                  src={videoSrc ? `${videoSrc}#t=0.001` : undefined}
                  poster={video.thumbnail ? unescape(video.thumbnail) : undefined}
                  playsInline
                  muted={isMuted}
                  preload={shouldPreload ? "auto" : "none"}
                  // loop
                  // controls
                  onClick={(e) => { 
                    e.preventDefault()
                    // Don't trigger click if we were scrubbing
                    if (isScrrubbingRef.current) {
                      isScrrubbingRef.current = false
                      return
                    }
                    handleVideoClick(video.id, index) 
                  }}
                  onTouchStart={(e) => {
                    const touch = e.touches[0]
                    const videoEl = videoRefs.current[index]?.current
                    if (touch && videoEl) {
                      touchStartRef.current = {
                        x: touch.clientX,
                        y: touch.clientY,
                        time: videoEl.currentTime,
                        videoIndex: index
                      }
                    }
                  }}
                  onTouchMove={(e) => {
                    if (!touchStartRef.current || touchStartRef.current.videoIndex !== index) return
                    const touch = e.touches[0]
                    const videoEl = videoRefs.current[index]?.current
                    if (!touch || !videoEl || !videoEl.duration) return
                    
                    const deltaX = touch.clientX - touchStartRef.current.x
                    const deltaY = touch.clientY - touchStartRef.current.y
                    
                    // If not yet scrubbing, check if we should start
                    if (!isScrrubbingRef.current) {
                      // Require at least 10px movement to make a decision
                      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) return
                      
                      // Only activate scrubbing if moving mostly horizontally
                      if (Math.abs(deltaX) <= Math.abs(deltaY)) return
                      
                      isScrrubbingRef.current = true
                      setIsScrubbing(true)
                    }
                    
                    // Map touch X position directly to video progress
                    const rect = videoEl.getBoundingClientRect()
                    const relativeX = touch.clientX - rect.left
                    const percentage = Math.max(0, Math.min(1, relativeX / rect.width))
                    videoEl.currentTime = percentage * videoEl.duration
                  }}
                  onTouchEnd={() => {
                    touchStartRef.current = null
                    setIsScrubbing(false)
                    // Reset scrubbing flag after a short delay to prevent click from firing
                    setTimeout(() => {
                      isScrrubbingRef.current = false
                    }, 100)
                  }}
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
                  onTimeUpdate={(e) => {
                    const el = e.currentTarget
                    setVideoProgress(prev => ({
                      ...prev,
                      [video.id]: { currentTime: el.currentTime, duration: el.duration || 0 }
                    }))
                  }}
                  onLoadedMetadata={(e) => {
                    const el = e.currentTarget
                    setVideoProgress(prev => ({
                      ...prev,
                      [video.id]: { currentTime: el.currentTime, duration: el.duration || 0 }
                    }))
                  }}
                />
                {/* Play overlay when paused */}
                {isActive && userPaused[video.id] && (
                  <div
                    className="absolute inset-0 flex items-center justify-center cursor-pointer text-white/60"
                    onClick={(e) => { e.preventDefault(); handleVideoClick(video.id, index) }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="1rem"
                      height="1rem"
                      className="size-30"
                      viewBox="0 0 24 24"
                    >
                      <path fill="currentColor" d="M8 17.175V6.825q0-.425.3-.713t.7-.287q.125 0 .263.037t.262.113l8.15 5.175q.225.15.338.375t.112.475t-.112.475t-.338.375l-8.15 5.175q-.125.075-.262.113T9 18.175q-.4 0-.7-.288t-.3-.712" />
                    </svg>
                  </div>
                )}
                {/* Progress bar */}
                {(() => {
                  const progress = videoProgress[video.id]
                  const percentage = progress && progress.duration > 0 
                    ? (progress.currentTime / progress.duration) * 100 
                    : 0
                  return (
                    <div 
                      className="absolute bottom-0 left-0 right-0 h-1 bg-white/20 cursor-pointer group"
                      onClick={(e) => {
                        e.stopPropagation()
                        const rect = e.currentTarget.getBoundingClientRect()
                        const clickX = e.clientX - rect.left
                        const percentage = clickX / rect.width
                        const videoEl = videoRefs.current[index]?.current
                        if (videoEl && progress?.duration) {
                          videoEl.currentTime = percentage * progress.duration
                        }
                      }}
                    >
                      <div 
                        className="h-full bg-white/20 group-hover:bg-white/80 transition-all duration-100"
                        style={{ width: `${percentage}%` }}
                      />
                      <div 
                        className="absolute top-1/2 -translate-y-[2px] w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ left: `${percentage}%`, transform: `translate(-50%, -50%)` }}
                      />
                    </div>
                  )
                })()}
                <div className="absolute bottom-2 left-0 right-0 w-full p-4 text-base font-medium text-white text-shadow-lg/30 flex flex-col gap-0.5">
                  {video.subreddit && (
                    <a
                      href={`https://reddit.com/r/${video.subreddit}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      r/{video.subreddit}
                    </a>
                  )}
                  {video.reddit_url ? (
                    <a
                      href={video.reddit_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white line-clamp-1 hover:line-clamp-none"
                    >
                      {unescape(video.title)}
                    </a>
                  ) : (
                    unescape(video.title)
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

