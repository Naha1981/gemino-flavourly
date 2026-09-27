import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { expireBookingDrafts } from '@/lib/revenue/booking-drafts';

export const dynamic='force-dynamic';
export const runtime='nodejs';

export async function GET(req:NextRequest){
 const authError=assertCronAuthorized(req); if(authError)return authError;
 try{return NextResponse.json({ok:true,expired:await expireBookingDrafts()});}
 catch(error){console.error('[Booking Drafts] expiry sweep failed',error);return NextResponse.json({ok:false,error:'Expiry sweep failed'},{status:500})}
}
