import data from "./data.json"
import { VideoFeed } from "../components/VideoFeed"

type RedditListing = {
  data: {
    children: {
      data: any
    }[]
  }
}

type VideoItem = {
  id: string
  title: string
  src: string
  hls_url?: string
  thumbnail?: string
}

function extractVideoFromPost(post: any): VideoItem | null {
  const id = post.id as string | undefined
  const title = (post.title as string | undefined) ?? "Untitled"

  const redditVideo =
    post.secure_media?.reddit_video ??
    post.media?.reddit_video ??
    post.preview?.reddit_video_preview

  let src: string | undefined
  const hls_url: string | undefined = redditVideo?.hls_url ?? redditVideo?.hlsUrl

  if (redditVideo?.fallback_url) {
    src = redditVideo.fallback_url as string
  } else if (typeof post.url_overridden_by_dest === "string") {
    src = post.url_overridden_by_dest as string
  } else if (typeof post.url === "string") {
    src = post.url as string
  }

  if (!id || (!src && !hls_url)) return null

  // Only keep obvious video URLs
  const baseSrc = (hls_url ?? src) as string
  const lowerSrc = baseSrc.toLowerCase()
  const looksLikeVideo =
    lowerSrc.endsWith(".mp4") ||
    lowerSrc.endsWith(".webm") ||
    lowerSrc.endsWith(".m3u8") ||
    lowerSrc.includes("v.redd.it") ||
    lowerSrc.includes("reddit_video") ||
    lowerSrc.includes(".hls")

  if (!looksLikeVideo) return null

  const thumb =
    post.thumbnail && typeof post.thumbnail === "string" && post.thumbnail.startsWith("http")
      ? (post.thumbnail as string)
      : post.preview?.images?.[0]?.source?.url

  return {
    id,
    title,
    src: src ?? hls_url ?? "",
    hls_url,
    thumbnail: typeof thumb === "string" ? thumb : undefined,
  }
}

function getVideosFromListing(raw: any): VideoItem[] {
  const listing = raw as RedditListing
  if (!listing?.data?.children) return []
  const videos = listing.data.children
    .map(child => extractVideoFromPost(child.data))
    .filter((v): v is VideoItem => v !== null)

  // Ensure stable uniqueness by id
  const seen = new Set<string>()
  const unique: VideoItem[] = []
  for (const v of videos) {
    if (seen.has(v.id)) continue
    seen.add(v.id)
    unique.push(v)
  }
  return unique
}

export default function Page() {
  const videos = getVideosFromListing(data)

  return <VideoFeed videos={videos} />
}
