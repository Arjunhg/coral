"use client"
import { useUser } from '@clerk/nextjs';
import { UserDetailContext } from '@/context/UserDetailContext';
import axios from 'axios';
import React, { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation';

function Provider({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {

    const { user } = useUser();
    const [userDetail, setUserDetail] = useState<any>();
    const pendoInitialized = useRef(false);
    const pathname = usePathname();

    useEffect(() => {
        if(!pendoInitialized.current){
            pendoInitialized.current = true;
            pendo.initialize({ visitor: { id: 'anonymous-' + Date.now() } });
        }
    }, []);
    
    useEffect(() => {
        if(pendoInitialized.current){
            pendo.pageLoad();
        }
    }, [pathname]);

    useEffect(() => {
        if (user) {
            CreateNewUser();
        }
    }, [user])

    const CreateNewUser = async () => {
        const result = await axios.post('/api/users', {});

        const userData = result.data?.user;
        setUserDetail(userData);

        if (userData) {
            pendo.identify({
                visitor: {
                    id: String(userData.id),
                    email: userData.email,
                    full_name: userData.name,
                    createdAt: userData.createdAt,
                    credits: userData.credits
                }
            });

            if(result.data?.isNewUser){
                (window as any).pendo?.track("user_account_created", {
                    isNewUser: true,
                    userId: userData.id,
                })
            }
        }
    }

    return (
        <UserDetailContext.Provider value={{ userDetail, setUserDetail }}>
            <div>{children}</div>
        </UserDetailContext.Provider>
    )
}

export default Provider