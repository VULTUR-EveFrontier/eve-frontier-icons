# EVE Frontier Icons CDN Deployment

A specialized tool for deploying EVE Frontier asset icons to S3-compatible storage providers for CDN distribution.

## Overview

This package provides production-ready deployment scripts for EVE Frontier assets extracted by `eve-frontier-tools`. It handles:

- **S3-Compatible Storage**: Upload assets to AWS S3, DigitalOcean Spaces, MinIO, or any S3-compatible provider
- **CDN Distribution**: Optimal configuration for CDN performance
- **Cache Optimization**: Appropriate cache headers for different file types
- **Change Detection**: Only uploads modified files
- **Version Management**: Automatic versioning with latest pointers

## Supported Providers

- **AWS S3** - Amazon Simple Storage Service
- **DigitalOcean Spaces** - Object storage with S3 compatibility
- **MinIO** - Self-hosted S3-compatible storage
- **Any S3-compatible provider** - Uses standard S3 API

## Quick Start

### 1. Prerequisites

Extract assets using eve-frontier-tools:

```bash
cd ../eve-frontier-tools
npm run pipeline -- --steps frontier
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Storage Provider

**AWS S3:**

```bash
aws configure
# or
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
```

**DigitalOcean Spaces:**

```bash
export S3_ACCESS_KEY_ID=your-spaces-key
export S3_SECRET_ACCESS_KEY=your-spaces-secret
export S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
```

**MinIO:**

```bash
export S3_ACCESS_KEY_ID=your-minio-key
export S3_SECRET_ACCESS_KEY=your-minio-secret
export S3_ENDPOINT=https://minio.example.com
export S3_FORCE_PATH_STYLE=true
```

### 4. Deploy to Storage

```bash
export S3_BUCKET_NAME=your-bucket-name
npm run deploy:s3
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run deploy:s3` | Deploy assets to S3 |
| `npm run deploy:s3:dry` | Dry run without uploading |
| `npm run deploy:s3:force` | Force upload all files |
| `npm run deploy:cloudfront` | Deploy with CloudFront |
| `npm run help` | Show help information |

## Configuration

Configure deployment using environment variables:

### Required

- `S3_BUCKET_NAME` - Bucket/Space name

### Optional

- `S3_REGION` - Region (default: us-east-1)
- `S3_ENDPOINT` - Custom endpoint for non-AWS providers
- `S3_ACCESS_KEY_ID` - Access key ID
- `S3_SECRET_ACCESS_KEY` - Secret access key
- `S3_FORCE_PATH_STYLE` - Force path-style URLs (true/false, required for some providers)
- `S3_PATH_PREFIX` - Path prefix (default: frontier-icons)
- `DEPLOY_VERSION` - Deployment version (auto-generated)
- `DRY_RUN` - Perform dry run (true/false)
- `FORCE_UPLOAD` - Force upload all files (true/false)

### AWS-Specific (for AWS S3 only)

- `AWS_PROFILE` - AWS CLI profile name
- `AWS_REGION` - AWS region (fallback for S3_REGION)
- `AWS_ACCESS_KEY_ID` - AWS access key (fallback for S3_ACCESS_KEY_ID)
- `AWS_SECRET_ACCESS_KEY` - AWS secret key (fallback for S3_SECRET_ACCESS_KEY)

## Deployment Structure

Assets are deployed with this S3 structure:

```text
s3://your-bucket/
├── frontier-icons/
│   ├── v2024.12.02.1430/              # Versioned deployment
│   │   ├── ui/texture/icons/frontier/
│   │   │   ├── ActiveCooling.png
│   │   │   └── ...
│   │   └── frontier_assets.json
│   └── latest/                        # Latest version pointer
│       └── frontier_assets.json       # With version metadata
```

## Next.js Integration

After deployment, configure your Next.js app:

```bash
# .env.local
NEXT_PUBLIC_FRONTIER_ASSETS_USE_CDN=true
NEXT_PUBLIC_FRONTIER_ASSETS_CDN_DOMAIN=https://your-bucket.s3.amazonaws.com
NEXT_PUBLIC_FRONTIER_ASSETS_CDN_PATH_PREFIX=frontier-icons
NEXT_PUBLIC_FRONTIER_ASSETS_CDN_VERSION=v2024.12.02.1430
```

## Examples

### AWS S3

**Basic Deployment:**

```bash
S3_BUCKET_NAME=my-frontier-assets npm run deploy:s3
```

**Production Deployment:**

```bash
AWS_PROFILE=production \
S3_BUCKET_NAME=prod-frontier-assets \
DEPLOY_VERSION=v1.0.0 \
npm run deploy:s3
```

### DigitalOcean Spaces

```bash
S3_BUCKET_NAME=my-space \
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com \
S3_ACCESS_KEY_ID=your-spaces-key \
S3_SECRET_ACCESS_KEY=your-spaces-secret \
S3_REGION=nyc3 \
npm run deploy:s3
```

### MinIO

```bash
S3_BUCKET_NAME=my-bucket \
S3_ENDPOINT=https://minio.example.com \
S3_FORCE_PATH_STYLE=true \
S3_ACCESS_KEY_ID=your-minio-key \
S3_SECRET_ACCESS_KEY=your-minio-secret \
npm run deploy:s3
```

### Test Without Uploading

```bash
S3_BUCKET_NAME=test-bucket npm run deploy:s3:dry
```

## Cache Headers

The deployment automatically sets optimal cache headers:

- **Images** (PNG): `public, max-age=31536000, immutable` (1 year)
- **Manifest** (JSON): `public, max-age=300` (5 minutes)  
- **Other files**: `public, max-age=86400` (1 day)

## Workflow Integration

### Complete Process

```bash
# 1. Extract assets
cd ../eve-frontier-tools
npm run pipeline -- --steps frontier

# 2. Deploy to CDN
cd ../eve-frontier-icons
export S3_BUCKET_NAME=your-bucket
npm run deploy:s3

# 3. Update Next.js app with new CDN URLs
```

### CI/CD Integration

See the GitHub Actions example in the documentation for automated deployments.

## Troubleshooting

### Common Issues

#### Permission Denied

```bash
aws sts get-caller-identity  # Check credentials
aws s3 ls s3://your-bucket/  # Check bucket access
```

#### Files Not Found

```bash
# Make sure extraction was run first
cd ../eve-frontier-tools
npm run pipeline -- --steps frontier
```

#### Debug Mode

```bash
DEBUG=true npm run deploy:s3
```

## Security

### S3 Bucket Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow", 
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-bucket/frontier-icons/*"
    }
  ]
}
```

## Related

- [eve-frontier-tools](../eve-frontier-tools/) - Asset extraction
- [vultr-site](../vultr-site/) - Next.js integration
- [Documentation](./README-s3-deployment.md) - Detailed deployment guide

## License

MIT
