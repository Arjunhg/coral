"use client"
import { useUser } from '@clerk/nextjs';
import { UserDetailContext } from '@/context/UserDetailContext';
import axios from 'axios';
import React, { useEffect, useState } from 'react'

function Provider({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {

    const { user } = useUser();
    const [userDetail, setUserDetail] = useState<any>();

    useEffect(() => {
        if (user) {
            CreateNewUser();
        }
    }, [user])

    const CreateNewUser = async () => {
        const result = await axios.post('/api/users', {});

        console.log("Result", result);
        setUserDetail(result.data?.user);

        try {
            const createdUser = result.data?.user;
            if (createdUser?.id && !localStorage.getItem(`pendo_tracked_user_${createdUser.id}`)) {
                localStorage.setItem(`pendo_tracked_user_${createdUser.id}`, "1");
                (window as any).pendo?.track("user_account_created", {
                    user_email: user?.primaryEmailAddress?.emailAddress || "",
                    user_name: user?.fullName || "",
                    initial_credits: createdUser?.credits ?? 1000,
                });
            }
        } catch (e) { /* ignore tracking errors */ }

    }

    return (
        <UserDetailContext.Provider value={{ userDetail, setUserDetail }}>
            <div>{children}</div>
        </UserDetailContext.Provider>
    )
}

export default Provider