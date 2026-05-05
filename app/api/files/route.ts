import { NextRequest, NextResponse } from "next/server";
import { S3Client, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";

const region = process.env.AWS_REGION!;
const bucket = process.env.S3_BUCKET_NAME!;

function s3Client() {
  return new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

function publicUrl(key: string) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

export async function GET(req: NextRequest) {
  const prefix = req.nextUrl.searchParams.get("prefix") ?? "";

  if (!bucket || !region) {
    return NextResponse.json({ error: "S3 not configured" }, { status: 500 });
  }

  try {
    const s3 = s3Client();
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 })
    );

    const files = (res.Contents ?? [])
      .filter((obj) => obj.Key && obj.Key !== prefix)
      .map((obj) => ({
        key: obj.Key!,
        name: path.basename(obj.Key!),
        size: obj.Size ?? 0,
        lastModified: obj.LastModified?.toISOString() ?? null,
        url: publicUrl(obj.Key!),
      }));

    return NextResponse.json({ files });
  } catch (err) {
    console.error("[files/GET]", err);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!bucket || !region) {
    return NextResponse.json({ error: "S3 not configured" }, { status: 500 });
  }

  const body = await req.json();
  const { filename, contentType } = body as { filename: string; contentType: string };

  if (!filename || !contentType) {
    return NextResponse.json({ error: "filename and contentType required" }, { status: 400 });
  }

  // Strip any path traversal
  const safeKey = path.basename(filename);

  try {
    const s3 = s3Client();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: safeKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

    return NextResponse.json({ uploadUrl, publicUrl: publicUrl(safeKey) });
  } catch (err) {
    console.error("[files/POST]", err);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}
