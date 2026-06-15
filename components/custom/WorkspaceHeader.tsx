"use client";

import Link from "next/link";
import { UserButton } from '@clerk/nextjs'
import { useContext } from 'react'
import { UserDetailContext } from '@/context/UserDetailContext'
import { Coins } from 'lucide-react'

function WorkspaceHeader() {
    const { userDetail } = useContext(UserDetailContext);

    return (
        <div className='flex w-full flex-wrap justify-between items-center gap-3 px-3 py-3 sm:px-5 shadow-sm bg-white border-b'>
            {/* Logo / Brand */}
            <a
                href="/"
                className="flex items-center gap-2 group"
            >
                <div className="flex flex-col leading-none">
                    <span className="text-[18px] font-semibold tracking-tight text-zinc-900 group-hover:text-blue-600 transition-colors">
                        Scriptless
                        <span className="text-blue-600">.ai</span>
                    </span>

                    <span className="hidden min-[361px]:block text-[11px] text-zinc-500 font-medium tracking-wide">
                        AI Testing Workspace
                    </span>
                </div>
            </a>

            {/* User Details & Button */}
            <div className='flex items-center gap-2 sm:gap-4'>
                <Link
                    href="/workspace/integrations"
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs sm:text-sm font-medium text-zinc-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                >
                    Integrations
                </Link>
                {userDetail && (
                    <div className='flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2 py-1 sm:px-3 rounded-full text-xs sm:text-sm font-medium border border-blue-100'>
                        <Coins className='w-4 h-4 text-blue-500' />
                        <span className='whitespace-nowrap'>{userDetail.credits} Credits</span>
                    </div>
                )}

                <UserButton />
            </div>
        </div>
    )
}

export default WorkspaceHeader
