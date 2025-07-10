#!/usr/bin/env node

/**
 * EVE Frontier Assets S3-Compatible Deployment Script
 * 
 * Uploads extracted frontier assets to S3-compatible storage (AWS S3, DigitalOcean Spaces, etc.)
 * for CDN distribution. Supports versioning, cache headers, proper MIME types, automatic 
 * public read permissions, and CORS configuration for global accessibility.
 * 
 * Features:
 * - Automatic public read ACL for all uploaded objects
 * - CORS configuration for cross-origin access
 * - Versioning with auto-generated timestamps
 * - Change detection using MD5 hashes
 * - Proper MIME types and cache headers
 * - Dry run and force upload modes
 * 
 * Supported Providers:
 * - AWS S3
 * - DigitalOcean Spaces
 * - MinIO
 * - Any S3-compatible storage service
 */

import { S3Client, PutObjectCommand, HeadObjectCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import mime from 'mime-types';

import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const config = {
  // S3-Compatible Storage Configuration
  bucket: process.env.S3_BUCKET_NAME || process.env.S3_BUCKET || process.env.AWS_S3_BUCKET,
  region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT, // Custom endpoint for non-AWS providers
  accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
  profile: process.env.AWS_PROFILE,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  keyPrefix: process.env.S3_PATH_PREFIX || process.env.S3_KEY_PREFIX || 'frontier-icons',
  
  // Deployment Configuration
  version: process.env.DEPLOY_VERSION || generateVersion(),
  dryRun: process.env.DRY_RUN === 'true',
  force: process.env.FORCE_UPLOAD === 'true',
  setupCors: process.env.SETUP_CORS === 'true',
  
  // CORS Configuration
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  
  // Cache Configuration
  cacheControl: {
    images: 'public, max-age=31536000, immutable', // 1 year for images
    manifest: 'public, max-age=300', // 5 minutes for manifest
    default: 'public, max-age=86400' // 1 day default
  },
  
  // Paths - look for eve-frontier-tools in sibling directory
  extractedDir: path.resolve(__dirname, '../../eve-frontier-tools/data/extracted'),
  iconsDir: path.resolve(__dirname, '../../eve-frontier-tools/data/extracted/icons'),
  manifestFile: path.resolve(__dirname, '../../eve-frontier-tools/data/extracted/frontier_assets.json')
};

/**
 * Generate a version string based on current timestamp
 */
function generateVersion() {
  const now = new Date();
  return `v${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}.${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Create S3 client with proper credentials and endpoint configuration
 */
function createS3Client() {
  const clientConfig = {
    region: config.region,
    ...(config.endpoint ? { forcePathStyle: true } : {})
  };

  // Configure custom endpoint for non-AWS providers
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    clientConfig.forcePathStyle = config.forcePathStyle;
  }

  // Configure credentials
  if (config.accessKeyId && config.secretAccessKey) {
    // Use explicit credentials
    clientConfig.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
  } else if (config.profile) {
    // Use AWS profile
    clientConfig.credentials = fromIni({ profile: config.profile });
  }
  // Otherwise use default credential chain (environment variables, IAM roles, etc.)

  return new S3Client(clientConfig);
}

/**
 * Calculate file hash for change detection
 */
async function calculateFileHash(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  return createHash('md5').update(fileBuffer).digest('hex');
}

/**
 * Check if file already exists in S3 with same content
 */
async function fileExistsInS3(s3Client, key, localHash) {
  if (config.force) return false;
  
  try {
    const command = new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key
    });
    
    const response = await s3Client.send(command);
    const s3Hash = response.ETag?.replace(/"/g, '');
    
    return s3Hash === localHash;
  } catch (error) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
}

/**
 * Upload a single file to S3
 */
async function uploadFile(s3Client, localPath, s3Key, options = {}) {
  const fileBuffer = await fs.readFile(localPath);
  const fileHash = await calculateFileHash(localPath);
  
  // Check if file already exists with same content
  if (!config.force && await fileExistsInS3(s3Client, s3Key, fileHash)) {
    console.log(`⏭️  Skipping ${s3Key} (unchanged)`);
    return { skipped: true };
  }
  
  // Determine MIME type
  const mimeType = mime.lookup(localPath) || 'application/octet-stream';
  
  // Determine cache control
  let cacheControl = config.cacheControl.default;
  if (mimeType.startsWith('image/')) {
    cacheControl = config.cacheControl.images;
  } else if (localPath.endsWith('.json')) {
    cacheControl = config.cacheControl.manifest;
  }
  
  const uploadParams = {
    Bucket: config.bucket,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: mimeType,
    CacheControl: cacheControl,
    ContentMD5: Buffer.from(fileHash, 'hex').toString('base64'),
    ACL: 'public-read', // Ensure global read access
    ...options
  };
  
  if (config.dryRun) {
    console.log(`🔍 [DRY RUN] Would upload ${s3Key} (${mimeType}, ${Math.round(fileBuffer.length / 1024)}KB) with public-read ACL`);
    return { uploaded: true, dryRun: true };
  }
  
  try {
    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);
    console.log(`✅ Uploaded ${s3Key} (${mimeType}, ${Math.round(fileBuffer.length / 1024)}KB)`);
    return { uploaded: true };
  } catch (error) {
    console.error(`❌ Failed to upload ${s3Key}:`, error.message);
    throw error;
  }
}

/**
 * Get all files in a directory recursively
 */
async function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    
    if (item.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else {
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      files.push({
        localPath: fullPath,
        relativePath: relativePath
      });
    }
  }
  
  return files;
}

/**
 * Upload all icon files
 */
async function uploadIcons(s3Client) {
  console.log('📁 Uploading icon files...');
  
  const iconFiles = await getAllFiles(config.iconsDir);
  const results = { uploaded: 0, skipped: 0, errors: 0 };
  
  for (const file of iconFiles) {
    try {
      const s3Key = `${config.keyPrefix}/${config.version}/${file.relativePath}`;
      const result = await uploadFile(s3Client, file.localPath, s3Key);
      
      if (result.uploaded) results.uploaded++;
      if (result.skipped) results.skipped++;
    } catch (error) {
      results.errors++;
      console.error(`❌ Error uploading ${file.relativePath}:`, error.message);
    }
  }
  
  console.log(`📁 Icons upload summary: ${results.uploaded} uploaded, ${results.skipped} skipped, ${results.errors} errors`);
  return results;
}

/**
 * Upload manifest file
 */
async function uploadManifest(s3Client) {
  console.log('📄 Uploading manifest file...');
  
  const s3Key = `${config.keyPrefix}/${config.version}/frontier_assets.json`;
  
  try {
    const result = await uploadFile(s3Client, config.manifestFile, s3Key);
    console.log('📄 Manifest upload completed');
    return result;
  } catch (error) {
    console.error('❌ Failed to upload manifest:', error.message);
    throw error;
  }
}

/**
 * Upload latest version manifest (without version prefix)
 */
async function uploadLatestManifest(s3Client) {
  console.log('🔄 Uploading latest manifest pointer...');
  
  // Read the original manifest
  const manifestContent = await fs.readFile(config.manifestFile);
  const manifest = JSON.parse(manifestContent);
  
  // Generate base URL based on configuration
  let baseUrl;
  if (config.endpoint) {
    // Custom endpoint (e.g., DigitalOcean Spaces)
    const endpointUrl = new URL(config.endpoint);
    baseUrl = `${endpointUrl.protocol}//${config.bucket}.${endpointUrl.hostname}/${config.keyPrefix}/${config.version}`;
  } else {
    // AWS S3
    baseUrl = `https://${config.bucket}.s3.amazonaws.com/${config.keyPrefix}/${config.version}`;
  }

  // Update the manifest to include version information
  const versionedManifest = {
    ...manifest,
    metadata: {
      ...manifest.metadata,
      deployedVersion: config.version,
      deployedAt: new Date().toISOString(),
      baseUrl: baseUrl
    }
  };
  
  const s3Key = `${config.keyPrefix}/latest/frontier_assets.json`;
  
  const uploadParams = {
    Bucket: config.bucket,
    Key: s3Key,
    Body: JSON.stringify(versionedManifest, null, 2),
    ContentType: 'application/json',
    CacheControl: config.cacheControl.manifest,
    ACL: 'public-read' // Ensure global read access
  };
  
  if (config.dryRun) {
    console.log(`🔍 [DRY RUN] Would upload latest manifest to ${s3Key} with public-read ACL`);
    return { uploaded: true, dryRun: true };
  }
  
  try {
    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);
    console.log('✅ Latest manifest uploaded');
    return { uploaded: true };
  } catch (error) {
    console.error('❌ Failed to upload latest manifest:', error.message);
    throw error;
  }
}

/**
 * Configure CORS for the bucket to allow cross-origin access
 */
async function configureCors(s3Client) {
  console.log('🌐 Configuring CORS settings...');
  
  const corsConfiguration = {
    CORSRules: [
      {
        AllowedOrigins: config.corsOrigins,
        AllowedMethods: ['GET', 'HEAD'],
        AllowedHeaders: ['*'],
        MaxAgeSeconds: 3600,
        ExposeHeaders: ['ETag']
      }
    ]
  };
  
  if (config.dryRun) {
    console.log('🔍 [DRY RUN] Would configure CORS with the following settings:');
    console.log('   Origins:', config.corsOrigins.join(', '));
    console.log('   Methods: GET, HEAD');
    console.log('   Headers: *');
    console.log('   Max Age: 3600 seconds');
    console.log('   Expose Headers: ETag');
    return { configured: true, dryRun: true };
  }
  
  try {
    const command = new PutBucketCorsCommand({
      Bucket: config.bucket,
      CORSConfiguration: corsConfiguration
    });
    
    await s3Client.send(command);
    console.log('✅ CORS configuration applied successfully');
    console.log('   Origins:', config.corsOrigins.join(', '));
    console.log('   Methods: GET, HEAD');
    console.log('   Max Age: 3600 seconds');
    return { configured: true };
  } catch (error) {
    console.error('❌ Failed to configure CORS:', error.message);
    throw error;
  }
}

/**
 * Validate configuration
 */
async function validateConfig() {
  const errors = [];
  
  if (!config.bucket) {
    errors.push('S3_BUCKET_NAME, S3_BUCKET, or AWS_S3_BUCKET environment variable is required');
  }
  
  // Check for credentials unless using AWS profile
  if (!config.profile && !config.accessKeyId) {
    errors.push('Access credentials required: Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or use AWS_PROFILE');
  }
  
  if (config.accessKeyId && !config.secretAccessKey) {
    errors.push('S3_SECRET_ACCESS_KEY is required when S3_ACCESS_KEY_ID is set');
  }
  
  try {
    await fs.access(config.extractedDir);
  } catch {
    errors.push(`Extracted directory not found: ${config.extractedDir}`);
    errors.push('Make sure to run extraction in eve-frontier-tools first: npm run pipeline -- --steps frontier');
  }
  
  try {
    await fs.access(config.manifestFile);
  } catch {
    errors.push(`Manifest file not found: ${config.manifestFile}`);
  }
  
  if (errors.length > 0) {
    console.error('❌ Configuration errors:');
    errors.forEach(error => console.error(`   ${error}`));
    process.exit(1);
  }
}

/**
 * Print deployment summary
 */
function printDeploymentInfo() {
  console.log('🚀 EVE Frontier Assets S3-Compatible Deployment');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📦 Bucket/Space:   ${config.bucket}`);
  console.log(`🌍 Region:         ${config.region}`);
  if (config.endpoint) {
    console.log(`🔗 Endpoint:       ${config.endpoint}`);
  }
  console.log(`📂 Path Prefix:    ${config.keyPrefix}`);
  console.log(`🏷️  Version:        ${config.version}`);
  console.log(`🔧 Dry Run:        ${config.dryRun ? 'Yes' : 'No'}`);
  console.log(`💪 Force Upload:   ${config.force ? 'Yes' : 'No'}`);
  console.log(`🌐 Setup CORS:     ${config.setupCors ? 'Yes' : 'No'}`);
  if (config.setupCors) {
    console.log(`   CORS Origins:   ${config.corsOrigins.join(', ')}`);
  }
  console.log(`📁 Source Dir:     ${config.extractedDir}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

/**
 * Main deployment function
 */
async function deploy() {
  try {
    printDeploymentInfo();
    await validateConfig();
    
    const s3Client = createS3Client();
    
    // Configure CORS if requested
    if (config.setupCors) {
      await configureCors(s3Client);
    }
    
    // Upload icons
    const iconResults = await uploadIcons(s3Client);
    
    // Upload versioned manifest
    await uploadManifest(s3Client);
    
    // Upload latest manifest pointer
    await uploadLatestManifest(s3Client);
    
    // Generate CDN URLs based on configuration
    let cdnDomain;
    if (config.endpoint) {
      // Custom endpoint (e.g., DigitalOcean Spaces)
      const endpointUrl = new URL(config.endpoint);
      cdnDomain = `${endpointUrl.protocol}//${config.bucket}.${endpointUrl.hostname}`;
    } else {
      // AWS S3
      cdnDomain = `https://${config.bucket}.s3.amazonaws.com`;
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Deployment completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Deployment Summary:');
    console.log(`   📁 Icons: ${iconResults.uploaded} uploaded, ${iconResults.skipped} skipped`);
    console.log(`   📄 Manifest: uploaded to versioned and latest paths`);
    if (config.setupCors) {
      console.log(`   🌐 CORS: configured for ${config.corsOrigins.length} origins`);
    }
    console.log('');
    console.log('🔗 CDN URLs:');
    console.log(`   Versioned: ${cdnDomain}/${config.keyPrefix}/${config.version}/`);
    console.log(`   Latest: ${cdnDomain}/${config.keyPrefix}/latest/`);
    console.log('');
    console.log('⚙️  Environment Variables for Next.js:');
    console.log('   NEXT_PUBLIC_FRONTIER_ASSETS_USE_CDN=true');
    console.log(`   NEXT_PUBLIC_FRONTIER_ASSETS_CDN_DOMAIN=${cdnDomain}`);
    console.log(`   NEXT_PUBLIC_FRONTIER_ASSETS_CDN_PATH_PREFIX=${config.keyPrefix}`);
    console.log(`   NEXT_PUBLIC_FRONTIER_ASSETS_CDN_VERSION=${config.version}`);
    
  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
🚀 EVE Frontier Assets S3-Compatible Deployment

USAGE:
  npm run deploy:s3              Deploy to S3-compatible storage
  npm run deploy:s3:dry          Dry run (no actual upload)
  npm run deploy:s3:force        Force upload all files
  npm run deploy:s3:cors         Deploy and configure CORS

ENVIRONMENT VARIABLES:
  S3_BUCKET_NAME                 Bucket/Space name (required)
  S3_REGION                      Region (default: us-east-1)
  S3_ENDPOINT                    Custom endpoint (for non-AWS providers)
  S3_ACCESS_KEY_ID               Access key ID
  S3_SECRET_ACCESS_KEY           Secret access key
  S3_FORCE_PATH_STYLE            Force path-style URLs (true/false)
  S3_PATH_PREFIX                 Path prefix (default: frontier-icons)
  DEPLOY_VERSION                 Deployment version (auto-generated)
  DRY_RUN                        Perform dry run (true/false)
  FORCE_UPLOAD                   Force upload all files (true/false)
  SETUP_CORS                     Configure CORS settings (true/false)
  CORS_ORIGINS                   Comma-separated list of allowed origins (default: http://localhost:3000,https://vultur.one)

EXAMPLES:
  # AWS S3
  S3_BUCKET_NAME=my-bucket npm run deploy:s3
  AWS_PROFILE=prod S3_BUCKET_NAME=prod-assets npm run deploy:s3
  
  # DigitalOcean Spaces with CORS
  S3_BUCKET_NAME=my-space \\
  S3_ENDPOINT=https://nyc3.digitaloceanspaces.com \\
  S3_ACCESS_KEY_ID=your-key \\
  S3_SECRET_ACCESS_KEY=your-secret \\
  S3_REGION=nyc3 \\
  SETUP_CORS=true \\
  npm run deploy:s3
  
  # MinIO
  S3_BUCKET_NAME=my-bucket \\
  S3_ENDPOINT=https://minio.example.com \\
  S3_FORCE_PATH_STYLE=true \\
  S3_ACCESS_KEY_ID=your-key \\
  S3_SECRET_ACCESS_KEY=your-secret \\
  npm run deploy:s3

PREREQUISITES:
  1. Run extraction in eve-frontier-tools:
     cd ../eve-frontier-tools && npm run pipeline -- --steps frontier
  
  2. Configure your storage provider credentials
  
  3. Create bucket/space in your provider

For more information, see README.md
`);
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp();
  process.exit(0);
}

// Run deployment if called directly
if (process.argv.includes(__filename)) {
  deploy();
}

export { deploy, config }; 