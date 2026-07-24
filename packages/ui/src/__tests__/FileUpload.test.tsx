// packages/ui/src/__tests__/FileUpload.test.tsx · DEV-18.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileUpload, FileUploadItem } from '../components/FileUpload';

describe('FileUpload (dropzone)', () => {
  it('renders a keyboard-operable dropzone with label/hint/icon', () => {
    const html = renderToStaticMarkup(
      <FileUpload label="Upload KYC documents" hint="PDF/JPG up to 5MB" icon={<svg />}>
        Drag KYC documents here, or <strong>browse</strong>
      </FileUpload>,
    );
    expect(html).toContain('kvw-upload');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Upload KYC documents"');
    expect(html).toContain('PDF/JPG up to 5MB');
    expect(html).not.toContain('is-dragover');
  });

  it('applies is-dragover only when the caller-owned isDragOver prop is true', () => {
    const html = renderToStaticMarkup(<FileUpload label="x" isDragOver>Drop here</FileUpload>);
    expect(html).toContain('is-dragover');
  });
});

describe('FileUploadItem', () => {
  it('renders name/meta/status, omitting thumbnail when not supplied', () => {
    const html = renderToStaticMarkup(
      <FileUploadItem name="pan-card.jpg" meta="240 KB · uploaded" status={<span className="kvw-badge kvw-badge-success">verified</span>} />,
    );
    expect(html).toContain('kvw-upload-item');
    expect(html).toContain('pan-card.jpg');
    expect(html).toContain('240 KB');
    expect(html).toContain('verified');
    expect(html).not.toContain('class="thumb"');
  });

  it('renders the thumbnail slot when supplied', () => {
    const html = renderToStaticMarkup(<FileUploadItem name="x.jpg" thumbnail={<img alt="" src="x.jpg" />} />);
    expect(html).toContain('class="thumb"');
  });
});
