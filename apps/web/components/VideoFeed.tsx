"use client"

import { useEffect, useRef, useState } from "react"

type VideoItem = {
  id: string
  title: string
  src: string
  thumbnail?: string
}

type VideoFeedProps = {
  videos: VideoItem[]
}

export function VideoFeed({ videos }: VideoFeedProps) {
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})

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
          setLoaded(prev => {
            if (prev[video.id]) return prev
            return { ...prev, [video.id]: true }
          })
        }
      })

      if (activeId) {
        // Pause all videos first
        videoRefs.current.forEach(v => {
          if (v && !v.paused) {
            v.pause()
          }
        })

        // Then play the active one
        const activeIndex = videos.findIndex(v => v.id === activeId)
        const activeVideo = videoRefs.current[activeIndex]
        if (activeVideo) {
          // Some browsers require a catch on play()
          activeVideo
            .play()
            .catch(() => {
              // Ignore autoplay errors
            })
        }
      } else {
        // If nothing is strongly in view, pause all
        videoRefs.current.forEach(v => {
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
  }, [videos])

  return (
    <div className="h-screen w-full bg-black text-white flex justify-center">
      <div className="h-full w-full max-w-3xl snap-y snap-mandatory overflow-y-scroll">
        {videos.map((video, index) => {
          const isLoaded = loaded[video.id]
          return (
            <section
              key={video.id}
              ref={el => {
                sectionRefs.current[index] = el
              }}
              data-index={index}
              className="snap-start h-screen flex flex-col items-center justify-center px-4"
            >
              <div className="w-full aspect-9/16 max-h-[90vh] rounded-xl overflow-hidden bg-black shadow-xl flex items-center justify-center">
                <video
                  ref={el => {
                    videoRefs.current[index] = el
                  }}
                  className="h-full w-full object-contain bg-black"
                  src={isLoaded ? video.src : undefined}
                  data-src={video.src}
                  poster={video.thumbnail}
                  playsInline
                  muted
                  controls
                  preload="none"
                  autoPlay={isLoaded}
                  loop={true}
                />
              </div>
              <div className="mt-4 w-full max-w-md text-center text-base font-medium line-clamp-2">
                {video.title}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

