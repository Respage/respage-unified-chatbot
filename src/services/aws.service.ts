import {PutObjectCommandInput, S3} from "@aws-sdk/client-s3";

const s3 = new S3({
    credentials: {
        accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY
    },
    region: process.env.AWS_S3_REGION
} as any);

async function uploadRecording(filename: string, file: Buffer, mimeType = 'audio/mpeg')  {
    const params = {
        ACL: 'public-read',
        Bucket: process.env.AWS_S3_RECORDING_BUCKET,
        Body: file,
        Key: filename,
        ContentType: mimeType
    } as PutObjectCommandInput;

    await s3.putObject(params);

    return `https://${process.env.AWS_S3_RECORDING_BUCKET}.s3.amazonaws.com/${filename}`
}

export {
    uploadRecording
};
