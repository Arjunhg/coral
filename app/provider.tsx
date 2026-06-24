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
        pendo.initialize({
            visitor: {
                id: ''
            }
        });
    }, []);

    useEffect(() => {
        if (user) {
            CreateNewUser();
        }
    }, [user])

    const CreateNewUser = async () => {
        const result = await axios.post('/api/users', {});

        console.log("Result", result);
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
        }
    }

    return (
        <UserDetailContext.Provider value={{ userDetail, setUserDetail }}>
            <div>{children}</div>
        </UserDetailContext.Provider>
    )
}

export default Provider