// supabase/functions/html-renderer/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2.43.4';
Deno.serve(async (req)=>{
  // CORS対応（必要に応じて）
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }
  try {
    const url = new URL(req.url);
    const path = url.searchParams.get('path');
    if (!path) {
      return new Response('Missing required parameter: path', {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    const bucket = url.searchParams.get('bucket') || 'reports';
    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) {
      console.error('❌ Error downloading file:', error);
      return new Response(JSON.stringify({
        error: error.message
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    const filename = path.split('/').pop() || 'report.html';
    const disposition = url.searchParams.get('download') === 'true' ? 'attachment' : 'inline';
    return new Response(data, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    console.error('❌ Unexpected error:', e);
    return new Response(JSON.stringify({
      error: e.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});
